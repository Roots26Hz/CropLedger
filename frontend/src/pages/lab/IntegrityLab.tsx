/**
 * Payload integrity workflow:
 *   1 select a recorded reading → 2 show its canonical payload → 3 compute
 *   keccak256 → 4 verify against the ledger → 5 modify a field → 6 recompute
 *   → 7 verify the altered copy → 8 compare results.
 *
 * Nothing here is hard-coded: every verdict comes from an actual hash
 * comparison performed by the contract's verifyReading() (or the local demo
 * ledger), plus a local EIP-712 signature recovery.
 */
import { CheckCircle2, ClipboardPaste, FileJson, Pencil, RotateCcw, ShieldCheck, ShieldX, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { decodeError, type DecodedError } from "@core/errors.js";
import { canonicalize, hashCanonicalJson, parsePayloadJson, prettyPayload, validatePayload } from "@core/payload.js";
import { messageFromPayload, recoverReadingSigner } from "@core/signing.js";
import { signedReadingFromJson } from "@core/serialization.js";
import type { Hex, ReadingPayload } from "@core/types.js";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Callout } from "../../components/ui/Callout";
import { Card, CardBody, CardHeader } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { Field, Input, Select, TextArea } from "../../components/ui/Field";
import { CopyButton } from "../../components/ui/HashText";
import { Spinner } from "../../components/ui/Spinner";
import { useRoute } from "../../hooks/useRoute";
import { useLedger } from "../../state/LedgerContext";
import type { ReadingView } from "../../types/app";
import { cn } from "../../utils/cn";
import { formatDateTime } from "../../utils/format";

type Check = { state: "idle" } | { state: "loading" } | { state: "done"; value: boolean } | { state: "error"; error: DecodedError };

const EDITABLE: { key: keyof ReadingPayload; label: string }[] = [
  { key: "n", label: "N (mg/kg)" },
  { key: "p", label: "P (mg/kg)" },
  { key: "k", label: "K (mg/kg)" },
  { key: "soilMoistureBp", label: "Moisture (bp)" },
  { key: "phCenti", label: "pH × 100" },
  { key: "timestamp", label: "Timestamp" },
];

function Step({ n, title, children, className }: { n: number | string; title: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("relative pl-9", className)}>
      <span className="absolute top-0 left-0 flex size-6 items-center justify-center rounded-full bg-forest-600 text-[11px] font-semibold text-white">{n}</span>
      <p className="mb-2 text-sm font-semibold text-ink">{title}</p>
      {children}
    </div>
  );
}

/** Hash rendered with characters that differ from the reference highlighted. */
function HashDiff({ value, reference }: { value: string; reference: string }) {
  return (
    <span className="font-mono text-[12px] break-all">
      {value.split("").map((ch, i) => (
        <span key={i} className={ch !== reference[i] ? "rounded-sm bg-danger-100 text-danger-700" : undefined}>
          {ch}
        </span>
      ))}
    </span>
  );
}

function Verdict({ check, genuine }: { check: Check; genuine: boolean }) {
  if (check.state === "idle") return null;
  if (check.state === "loading")
    return (
      <div className="flex items-center gap-2 rounded-lg bg-surface-2 px-4 py-3 text-sm text-ink-muted">
        <Spinner /> Calling verifyReading…
      </div>
    );
  if (check.state === "error") return <Callout tone="danger" title="Verification call failed">{check.error.message}</Callout>;
  return check.value ? (
    <div className="flex animate-fade-in items-start gap-3 rounded-lg border border-forest-200 bg-forest-50 px-4 py-3">
      <ShieldCheck className="mt-0.5 size-5 shrink-0 text-forest-600" />
      <div>
        <p className="text-sm font-bold tracking-wide text-forest-700">VERIFIED — MATCHES THE LEDGER</p>
        <p className="mt-0.5 text-[13px] text-ink-muted">verifyReading returned <span className="font-mono">true</span>: this payload is byte-for-byte what the device signed and the ledger recorded.</p>
      </div>
    </div>
  ) : (
    <div className="flex animate-fade-in items-start gap-3 rounded-lg border border-danger-100 bg-danger-50 px-4 py-3">
      <ShieldX className="mt-0.5 size-5 shrink-0 text-danger-600" />
      <div>
        <p className="text-sm font-bold tracking-wide text-danger-700">{genuine ? "MISMATCH" : "TAMPERING DETECTED"}</p>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          verifyReading returned <span className="font-mono">false</span>: the recomputed hash differs from the hash stored on the ledger, so this payload is not the
          recorded one.
        </p>
      </div>
    </div>
  );
}

function SignatureLine({ ok, label }: { ok: boolean | null; label: string }) {
  if (ok === null) return <p className="text-xs text-ink-faint">Signature check unavailable (no signature stored with this payload).</p>;
  return ok ? (
    <p className="flex items-center gap-1.5 text-xs text-forest-700">
      <CheckCircle2 className="size-3.5" /> {label}: EIP-712 signature recovers to the registered device key
    </p>
  ) : (
    <p className="flex items-center gap-1.5 text-xs text-danger-600">
      <XCircle className="size-3.5" /> {label}: signature no longer matches — the device never signed these values
    </p>
  );
}

export function IntegrityLab() {
  const ledger = useLedger();
  const { route } = useRoute();
  const [deviceLabel, setDeviceLabel] = useState(route.params.get("device") ?? "");
  const [index, setIndex] = useState<number | null>(route.params.has("index") ? Number(route.params.get("index")) : null);
  const [readings, setReadings] = useState<ReadingView[]>([]);
  const [loadingReadings, setLoadingReadings] = useState(false);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasted, setPasted] = useState("");
  const [edits, setEdits] = useState<Partial<Record<keyof ReadingPayload, string>>>({});
  const [rawMode, setRawMode] = useState(false);
  const [rawText, setRawText] = useState("");
  const [originalCheck, setOriginalCheck] = useState<Check>({ state: "idle" });
  const [alteredCheck, setAlteredCheck] = useState<Check>({ state: "idle" });

  const device = ledger.devices.find((d) => d.label === deviceLabel);

  // Default to the first device with readings.
  useEffect(() => {
    if (deviceLabel && ledger.devices.some((d) => d.label === deviceLabel)) return;
    const first = ledger.devices.find((d) => d.readingCount > 0) ?? ledger.devices[0];
    if (first) setDeviceLabel(first.label);
  }, [ledger.devices, deviceLabel]);

  useEffect(() => {
    if (!device) {
      setReadings([]);
      return;
    }
    let cancelled = false;
    setLoadingReadings(true);
    ledger
      .getReadings(device.deviceId)
      .then((list) => {
        if (cancelled) return;
        setReadings(list);
        setIndex((current) => (current !== null && list.some((r) => r.index === current) ? current : (list.at(-1)?.index ?? null)));
      })
      .catch(() => !cancelled && setReadings([]))
      .finally(() => !cancelled && setLoadingReadings(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch on device or ledger change only
  }, [device?.deviceId, ledger.dataVersion]);

  const record = readings.find((r) => r.index === index) ?? null;
  const stored = record ? ledger.evidence.get(record.deviceLabel, record.nonce) : undefined;

  const reset = useCallback(() => {
    setEdits({});
    setRawMode(false);
    setOriginalCheck({ state: "idle" });
    setAlteredCheck({ state: "idle" });
  }, []);

  useEffect(reset, [record?.deviceId, record?.index, pasteMode, reset]);

  // ---- Original payload (from the off-chain store, or pasted by the user)
  const original = useMemo<{ payload: ReadingPayload | null; error: string | null }>(() => {
    if (pasteMode) {
      if (!pasted.trim()) return { payload: null, error: null };
      try {
        const parsed = JSON.parse(pasted) as { kind?: string };
        if (parsed?.kind === "cropledger.signed-reading") return { payload: signedReadingFromJson(parsed as never).payload, error: null };
        return { payload: parsePayloadJson(pasted), error: null };
      } catch (e) {
        return { payload: null, error: (e as Error).message };
      }
    }
    return { payload: stored?.payload ?? null, error: null };
  }, [pasteMode, pasted, stored]);

  const signature = !pasteMode ? stored?.signature : (() => {
    try {
      const parsed = JSON.parse(pasted) as { kind?: string; signature?: string };
      return parsed?.kind === "cropledger.signed-reading" ? parsed.signature : undefined;
    } catch {
      return undefined;
    }
  })();

  const originalCanonical = original.payload ? canonicalize(original.payload) : null;
  const originalHash = originalCanonical ? hashCanonicalJson(originalCanonical) : null;

  // ---- Altered copy
  useEffect(() => {
    if (original.payload) setRawText(prettyPayload(original.payload));
  }, [original.payload]);

  const altered = useMemo<{ payload: ReadingPayload | null; error: string | null }>(() => {
    if (!original.payload) return { payload: null, error: null };
    try {
      if (rawMode) return { payload: parsePayloadJson(rawText), error: null };
      const next: Record<string, unknown> = { ...original.payload };
      for (const [key, value] of Object.entries(edits)) {
        if (value === undefined) continue;
        next[key] = key === "anomalyLabel" ? value : value.trim() === "" ? Number.NaN : Number(value);
      }
      return { payload: validatePayload(next), error: null };
    } catch (e) {
      return { payload: null, error: (e as Error).message };
    }
  }, [original.payload, edits, rawMode, rawText]);

  const alteredCanonical = altered.payload ? canonicalize(altered.payload) : null;
  const alteredHash = alteredCanonical ? hashCanonicalJson(alteredCanonical) : null;
  const changed = useMemo(() => {
    if (!original.payload || !altered.payload) return [];
    return (Object.keys(original.payload) as (keyof ReadingPayload)[])
      .filter((k) => original.payload![k] !== altered.payload![k])
      .map((k) => ({ key: k, from: String(original.payload![k]), to: String(altered.payload![k]) }));
  }, [original.payload, altered.payload]);

  useEffect(() => setAlteredCheck({ state: "idle" }), [alteredHash]);

  const sigCheck = (payload: ReadingPayload | null): boolean | null => {
    if (!payload || !signature || !device || !ledger.service) return null;
    try {
      const { message } = messageFromPayload(payload);
      return recoverReadingSigner(ledger.service.domain, message, signature).toLowerCase() === device.signer.toLowerCase();
    } catch {
      return false;
    }
  };

  const verify = async (hash: Hex, set: (c: Check) => void) => {
    if (!record || !ledger.service) return;
    set({ state: "loading" });
    try {
      set({ state: "done", value: await ledger.service.verifyReading(record.deviceId, record.index, hash) });
    } catch (e) {
      set({ state: "error", error: decodeError(e) });
    }
  };

  const payloadMismatch = original.payload && record && (original.payload.deviceId !== record.deviceLabel || original.payload.nonce !== Number(record.nonce));

  if (ledger.devices.length === 0) {
    return (
      <Card>
        <EmptyState icon={<FileJson className="size-5" />} title="No recorded readings yet">
          Register a device and record readings in the Live Sensor Feed, then come back to verify them.
        </EmptyState>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Select a recorded reading" subtitle="The ledger stores only compact values and the payload hash; the full payload lives off-chain." />
        <CardBody className="space-y-5">
          <Step n={1} title="Choose the evidence record">
            <div className="grid gap-4 md:grid-cols-[1fr_1.6fr_auto]">
              <Field label="Device" htmlFor="lab-device">
                <Select id="lab-device" value={deviceLabel} onChange={(e) => { setDeviceLabel(e.target.value); setIndex(null); }}>
                  {ledger.devices.map((d) => (
                    <option key={d.deviceId} value={d.label}>
                      {d.label} · {d.fieldLabel} ({d.readingCount} readings)
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Reading" htmlFor="lab-reading">
                <Select id="lab-reading" value={index ?? ""} onChange={(e) => setIndex(Number(e.target.value))} disabled={readings.length === 0}>
                  {readings.length === 0 && <option value="">{loadingReadings ? "Loading…" : "No readings for this device"}</option>}
                  {[...readings].reverse().map((r) => (
                    <option key={r.index} value={r.index}>
                      #{r.index} · nonce {r.nonce.toString()} · N {r.n} P {r.p} K {r.k} · {formatDateTime(r.timestamp)}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="flex items-end">
                <Button variant={pasteMode ? "secondary" : "outline"} icon={<ClipboardPaste className="size-4" />} onClick={() => setPasteMode((p) => !p)}>
                  {pasteMode ? "Use stored payload" : "Paste payload JSON"}
                </Button>
              </div>
            </div>
            {record && (
              <div className="mt-4 grid gap-3 rounded-lg border border-line bg-surface-2 p-3 text-xs sm:grid-cols-4">
                <div>
                  <p className="text-ink-faint">Recorded values</p>
                  <p className="tabular mt-0.5 font-medium">N {record.n} · P {record.p} · K {record.k}</p>
                </div>
                <div>
                  <p className="text-ink-faint">Nonce · {ledger.service?.kind === "evm" ? "block" : "simulated block"}</p>
                  <p className="tabular mt-0.5 font-medium">{record.nonce.toString()} · {record.blockNumber.toString()}</p>
                </div>
                <div className="sm:col-span-2">
                  <p className="flex items-center gap-1 text-ink-faint">
                    Payload hash stored on the ledger <CopyButton value={record.payloadHash} />
                  </p>
                  <p className="mt-0.5 font-mono break-all">{record.payloadHash}</p>
                </div>
              </div>
            )}
          </Step>
          {pasteMode && (
            <Field label="Paste a payload (plain schema-v1 JSON, or a signed-reading export)" htmlFor="lab-paste" error={original.error ?? undefined}>
              <TextArea id="lab-paste" rows={8} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder='{"schema":"cropledger.reading.v1", …}' spellCheck={false} />
            </Field>
          )}
        </CardBody>
      </Card>

      {record && !original.payload && !pasteMode && (
        <Callout tone="warning" title="Full payload not available in this browser">
          The ledger only holds this reading's hash. Paste the original payload (for example the file written by the Node CLI in{" "}
          <span className="font-mono">.simulator/payloads/</span>) or import exported payloads in System Configuration.
        </Callout>
      )}

      {payloadMismatch && (
        <Callout tone="warning">
          The payload describes {original.payload!.deviceId} nonce {original.payload!.nonce}, but the selected record is {record!.deviceLabel} nonce{" "}
          {record!.nonce.toString()}. Verification will (correctly) fail.
        </Callout>
      )}

      {record && original.payload && originalHash && (
        <div className="grid gap-6 xl:grid-cols-2">
          {/* ------------------------------------------------ Genuine payload */}
          <Card>
            <CardHeader title="Original payload" subtitle={pasteMode ? "Pasted by you" : "From the off-chain payload store"} icon={<FileJson className="size-4" />} actions={<Badge tone="success">genuine copy</Badge>} />
            <CardBody className="space-y-5">
              <Step n={2} title="Canonical payload">
                <pre className="scrollbar-thin max-h-64 overflow-auto rounded-lg bg-forest-950 p-3 font-mono text-[11.5px] leading-relaxed text-forest-50">{prettyPayload(original.payload)}</pre>
                <p className="mt-1.5 text-[11px] text-ink-faint">Hashed as compact JSON with fixed key order ({originalCanonical!.length} bytes).</p>
              </Step>
              <Step n={3} title="keccak256(canonical JSON)">
                <p className="font-mono text-[12px] break-all">{originalHash}</p>
                <p className={cn("mt-1 text-xs", originalHash === record.payloadHash ? "text-forest-700" : "text-danger-600")}>
                  {originalHash === record.payloadHash ? "Identical to the stored hash." : "Differs from the stored hash."}
                </p>
                <SignatureLine ok={sigCheck(original.payload)} label="Original" />
              </Step>
              <Step n={4} title="Verify against the ledger">
                <Button icon={<ShieldCheck className="size-4" />} onClick={() => void verify(originalHash, setOriginalCheck)} loading={originalCheck.state === "loading"}>
                  Verify original
                </Button>
                <div className="mt-3">
                  <Verdict check={originalCheck} genuine />
                </div>
              </Step>
            </CardBody>
          </Card>

          {/* ------------------------------------------------ Altered copy */}
          <Card className={cn(changed.length > 0 && "border-danger-100")}>
            <CardHeader
              title="Altered copy"
              subtitle="Simulates someone editing the off-chain record after the fact"
              icon={<Pencil className="size-4" />}
              actions={
                <div className="flex gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => setRawMode((r) => !r)}>
                    {rawMode ? "Field editor" : "Edit raw JSON"}
                  </Button>
                  <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={reset}>
                    Reset
                  </Button>
                </div>
              }
            />
            <CardBody className="space-y-5">
              <Step n={5} title="Modify one field">
                {rawMode ? (
                  <TextArea rows={10} value={rawText} onChange={(e) => setRawText(e.target.value)} spellCheck={false} aria-label="Altered payload JSON" />
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {EDITABLE.map(({ key, label }) => (
                      <Field key={key} label={label} htmlFor={`edit-${key}`}>
                        <Input
                          id={`edit-${key}`}
                          inputMode="numeric"
                          className={cn("tabular font-mono", edits[key] !== undefined && String(original.payload![key]) !== edits[key] && "border-danger-500 bg-danger-50")}
                          value={edits[key] ?? String(original.payload![key])}
                          onChange={(e) => setEdits((all) => ({ ...all, [key]: e.target.value }))}
                        />
                      </Field>
                    ))}
                  </div>
                )}
                {altered.error && <p className="mt-2 text-xs text-danger-600">Invalid payload: {altered.error}</p>}
                {changed.length > 0 ? (
                  <ul className="mt-3 flex flex-wrap gap-1.5">
                    {changed.map((c) => (
                      <li key={c.key}>
                        <Badge tone="danger">
                          {c.key}: {c.from} → {c.to}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-ink-faint">Tip: change N by a few units, e.g. to make a field look more fertile in an insurance dispute.</p>
                )}
              </Step>
              <Step n={6} title="Recompute keccak256">
                {alteredHash ? (
                  <>
                    <HashDiff value={alteredHash} reference={record.payloadHash} />
                    <p className={cn("mt-1 text-xs", alteredHash === record.payloadHash ? "text-forest-700" : "text-danger-600")}>
                      {alteredHash === record.payloadHash
                        ? "Identical to the stored hash (nothing changed yet)."
                        : `${alteredHash.split("").filter((c, i) => c !== record.payloadHash[i]).length} of 64 hex characters differ from the stored hash.`}
                    </p>
                    <SignatureLine ok={sigCheck(altered.payload)} label="Altered" />
                  </>
                ) : (
                  <p className="text-xs text-ink-faint">Fix the payload to compute its hash.</p>
                )}
              </Step>
              <Step n={7} title="Verify the altered payload">
                <Button
                  variant={changed.length > 0 ? "danger" : "outline"}
                  icon={<ShieldX className="size-4" />}
                  disabled={!alteredHash}
                  disabledReason="The altered payload is not valid"
                  onClick={() => alteredHash && void verify(alteredHash, setAlteredCheck)}
                  loading={alteredCheck.state === "loading"}
                >
                  Verify altered copy
                </Button>
                <div className="mt-3">
                  <Verdict check={alteredCheck} genuine={changed.length === 0} />
                </div>
              </Step>
            </CardBody>
          </Card>
        </div>
      )}

      {originalCheck.state === "done" && alteredCheck.state === "done" && (
        <Card>
          <CardBody>
            <Step n={8} title="Result">
              <p className="text-sm text-ink-muted">
                Original: <strong className={originalCheck.value ? "text-forest-700" : "text-danger-600"}>{originalCheck.value ? "verified" : "not verified"}</strong> · Altered
                ({changed.length} field{changed.length === 1 ? "" : "s"} changed):{" "}
                <strong className={alteredCheck.value ? "text-forest-700" : "text-danger-600"}>{alteredCheck.value ? "verified" : "rejected"}</strong>. Both verdicts come from{" "}
                <span className="font-mono">verifyReading()</span> on the {ledger.service?.kind === "evm" ? "deployed contract (read-only eth_call, no gas)" : "local demo ledger"}. The
                altered payload was never submitted as a reading.
              </p>
            </Step>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
