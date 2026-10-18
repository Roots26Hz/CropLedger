import { Eye, FileSearch, FlaskConical, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { decodeError, type DecodedError } from "@core/errors.js";
import { explorerBlockUrl, explorerTxUrl } from "@core/networks.js";
import { prettyPayload } from "@core/payload.js";
import type { Hex } from "@core/types.js";
import { PageHeader } from "../components/layout/PageHeader";
import { NpkTrendChart } from "../components/NpkTrendChart";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Callout } from "../components/ui/Callout";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { Field, Input, Select } from "../components/ui/Field";
import { HashText } from "../components/ui/HashText";
import { Modal } from "../components/ui/Modal";
import { Spinner } from "../components/ui/Spinner";
import { Tabs } from "../components/ui/Tabs";
import { useRoute } from "../hooks/useRoute";
import { useLedger } from "../state/LedgerContext";
import { useSettings } from "../state/SettingsContext";
import type { ReadingView } from "../types/app";
import { fmt, formatDateTime } from "../utils/format";

type SearchBy = "device" | "field";

function toUnix(date: string, endOfDay = false): number | null {
  if (!date) return null;
  const d = new Date(`${date}T${endOfDay ? "23:59:59" : "00:00:00"}`);
  return Number.isNaN(d.getTime()) ? null : Math.floor(d.getTime() / 1000);
}

function InspectModal({ reading, onClose }: { reading: ReadingView | null; onClose: () => void }) {
  const { settings } = useSettings();
  const ledger = useLedger();
  const { navigate } = useRoute();
  const [tx, setTx] = useState<{ txHash: Hex; gasUsed: bigint; from: string } | null | undefined>(undefined);
  const [error, setError] = useState<DecodedError | null>(null);
  const [loading, setLoading] = useState(false);
  const isLocal = settings.mode === "local";
  const stored = reading ? ledger.evidence.get(reading.deviceLabel, reading.nonce) : undefined;

  useEffect(() => {
    setTx(undefined);
    setError(null);
  }, [reading]);

  const findTx = async () => {
    if (!reading || !ledger.service?.findReadingTransaction) return;
    setLoading(true);
    try {
      setTx(await ledger.service.findReadingTransaction(reading.deviceId, reading.index, reading.blockNumber));
    } catch (e) {
      setError(decodeError(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={reading !== null} onClose={onClose} title={reading ? `${reading.deviceLabel} · reading #${reading.index}` : ""} wide
      footer={reading && <Button icon={<FlaskConical className="size-4" />} onClick={() => navigate("lab", { device: reading.deviceLabel, index: reading.index })}>Open in Verification Lab</Button>}
    >
      {reading && (
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">{isLocal ? "Local demo record" : "On-chain record"}</h3>
            <dl className="divide-y divide-line text-sm">
              {[
                ["Device", `${reading.deviceLabel}`],
                ["Field", reading.fieldLabel],
                ["Sampled", formatDateTime(reading.timestamp)],
                ["N / P / K (mg/kg)", `${reading.n} / ${reading.p} / ${reading.k}`],
                ["Nonce", reading.nonce.toString()],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 py-1.5">
                  <dt className="text-ink-muted">{k}</dt>
                  <dd className="tabular text-right">{v}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-3 py-1.5">
                <dt className="text-ink-muted">{isLocal ? "Simulated block" : "Block"}</dt>
                <dd>
                  {!isLocal && explorerBlockUrl(settings.chainId, reading.blockNumber) ? (
                    <a className="font-mono text-xs text-chain-600 hover:underline" href={explorerBlockUrl(settings.chainId, reading.blockNumber)} target="_blank" rel="noreferrer noopener">
                      {reading.blockNumber.toString()}
                    </a>
                  ) : (
                    <span className="font-mono text-xs">{reading.blockNumber.toString()}</span>
                  )}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 py-1.5">
                <dt className="text-ink-muted">Device ID (bytes32)</dt>
                <dd>
                  <HashText value={reading.deviceId} />
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 py-1.5">
                <dt className="text-ink-muted">Payload hash</dt>
                <dd>
                  <HashText value={reading.payloadHash} />
                </dd>
              </div>
            </dl>
            <div className="mt-4">
              {isLocal ? (
                <Callout tone="warning">Local demo: this record was not written by a blockchain transaction, so there is no transaction hash.</Callout>
              ) : tx === undefined ? (
                <Button size="sm" variant="secondary" loading={loading} onClick={() => void findTx()}>
                  Find transaction
                </Button>
              ) : tx === null ? (
                <p className="text-sm text-ink-muted">No ReadingRecorded event found in block {reading.blockNumber.toString()}.</p>
              ) : (
                <dl className="space-y-1 rounded-lg bg-chain-50 p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-ink-muted">Transaction</dt>
                    <dd>
                      <HashText value={tx.txHash} href={explorerTxUrl(settings.chainId, tx.txHash)} />
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-ink-muted">Relayed by</dt>
                    <dd>
                      <HashText value={tx.from} chars={4} />
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-ink-muted">Gas used</dt>
                    <dd className="tabular font-mono text-xs">{tx.gasUsed.toLocaleString()}</dd>
                  </div>
                </dl>
              )}
              {error && <p className="mt-2 text-xs text-danger-600">{error.message}</p>}
            </div>
          </div>
          <div className="min-w-0">
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">Off-chain payload</h3>
            {stored ? (
              <>
                <pre className="scrollbar-thin max-h-80 overflow-auto rounded-lg bg-forest-950 p-3 font-mono text-[11.5px] leading-relaxed text-forest-50">{prettyPayload(stored.payload)}</pre>
                <p className="mt-2 text-xs text-ink-faint">
                  Moisture {fmt.moisture(stored.payload.soilMoistureBp)} · soil {fmt.temperature(stored.payload.soilTempCentiC)} · pH {fmt.ph(stored.payload.phCenti)} · edge AI{" "}
                  {stored.payload.anomalyLabel}
                </p>
              </>
            ) : (
              <EmptyState title="Payload not stored in this browser">
                Only its hash is on the ledger. Import the payload file (System Configuration) or paste it in the Verification Lab.
              </EmptyState>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

export function EvidenceExplorerPage() {
  const ledger = useLedger();
  const { route } = useRoute();
  const [searchBy, setSearchBy] = useState<SearchBy>("device");
  const [query, setQuery] = useState(route.params.get("device") ?? "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [results, setResults] = useState<ReadingView[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<DecodedError | null>(null);
  const [inspect, setInspect] = useState<ReadingView | null>(null);

  const fields = useMemo(() => [...new Set(ledger.devices.map((d) => d.fieldLabel))], [ledger.devices]);
  const options = searchBy === "device" ? ledger.devices.map((d) => d.label) : fields;

  useEffect(() => {
    if (!query && options.length > 0) setQuery(options[0]!);
  }, [options, query]);

  const retrieve = async () => {
    setLoading(true);
    setError(null);
    try {
      const matching = ledger.devices.filter((d) => (searchBy === "device" ? d.label === query : d.fieldLabel === query));
      const all = (await Promise.all(matching.map((d) => ledger.getReadings(d.deviceId)))).flat();
      const start = toUnix(from);
      const end = toUnix(to, true);
      setResults(
        all
          .filter((r) => (start === null || Number(r.timestamp) >= start) && (end === null || Number(r.timestamp) <= end))
          .sort((a, b) => Number(b.timestamp - a.timestamp) || b.index - a.index),
      );
    } catch (e) {
      setError(decodeError(e));
    } finally {
      setLoading(false);
    }
  };

  const chartData = useMemo(() => {
    if (!results || searchBy !== "device") return [];
    return [...results].reverse().map((r) => ({ x: Number(r.nonce), t: Number(r.timestamp) * 1000, n: r.n, p: r.p, k: r.k }));
  }, [results, searchBy]);

  const stored = results?.filter((r) => ledger.evidence.get(r.deviceLabel, r.nonce)).length ?? 0;

  return (
    <>
      <PageHeader
        title="Evidence Explorer"
        description="Retrieve the recorded history of a device or a whole field directly from the ledger, inspect each record and its transaction, and hand any reading to the Verification Lab."
      />

      <Card className="mb-6">
        <CardHeader title="Search the ledger" icon={<Search className="size-4" />} actions={<Tabs<SearchBy> items={[{ key: "device", label: "By device" }, { key: "field", label: "By field" }]} active={searchBy} onChange={(k) => { setSearchBy(k); setQuery(""); setResults(null); }} />} />
        <CardBody>
          <form
            className="grid items-end gap-4 md:grid-cols-[1.4fr_1fr_1fr_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              void retrieve();
            }}
          >
            <Field label={searchBy === "device" ? "Device ID" : "Field ID"} htmlFor="ev-query">
              {options.length > 0 ? (
                <Select id="ev-query" value={query} onChange={(e) => setQuery(e.target.value)}>
                  {options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input id="ev-query" disabled placeholder="No devices registered yet" />
              )}
            </Field>
            <Field label="From (optional)" htmlFor="ev-from">
              <Input id="ev-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="To (optional)" htmlFor="ev-to">
              <Input id="ev-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
            <Button type="submit" icon={<FileSearch className="size-4" />} loading={loading} disabled={!query} disabledReason="Register a device first">
              Retrieve history
            </Button>
          </form>
        </CardBody>
      </Card>

      {error && (
        <Callout tone="danger" className="mb-6" title="Could not retrieve readings">
          {error.message}
        </Callout>
      )}

      {results === null ? (
        <Card>
          <EmptyState icon={<FileSearch className="size-5" />} title="Choose a device or field and retrieve its history">
            Queries call getReadingCount and getReading on the {ledger.service?.kind === "evm" ? "deployed contract" : "local demo ledger"}.
          </EmptyState>
        </Card>
      ) : (
        <>
          {chartData.length > 1 && (
            <Card className="mb-6">
              <CardHeader title={`${query} history`} subtitle={`${chartData.length} recorded readings`} />
              <CardBody>
                <NpkTrendChart data={chartData} height={140} />
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader
              title={`${results.length} reading${results.length === 1 ? "" : "s"} found`}
              subtitle={`${stored} with the full off-chain payload in this browser`}
              actions={loading && <Spinner />}
            />
            {results.length === 0 ? (
              <EmptyState title="No readings match" />
            ) : (
              <div className="scrollbar-thin overflow-x-auto">
                <table className="w-full min-w-[920px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-ink-muted">
                      <th className="px-5 py-2.5 font-medium">Device · index</th>
                      <th className="px-3 py-2.5 font-medium">Sampled</th>
                      <th className="px-3 py-2.5 text-right font-medium">N</th>
                      <th className="px-3 py-2.5 text-right font-medium">P</th>
                      <th className="px-3 py-2.5 text-right font-medium">K</th>
                      <th className="px-3 py-2.5 text-right font-medium">Nonce</th>
                      <th className="px-3 py-2.5 font-medium">Block</th>
                      <th className="px-3 py-2.5 font-medium">Payload hash</th>
                      <th className="px-3 py-2.5 font-medium">Payload</th>
                      <th className="px-5 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {results.map((r) => (
                      <tr key={`${r.deviceId}-${r.index}`}>
                        <td className="px-5 py-2.5">
                          <p className="font-medium">{r.deviceLabel}</p>
                          <p className="text-xs text-ink-faint">
                            {r.fieldLabel} · #{r.index}
                          </p>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-ink-muted">{formatDateTime(r.timestamp)}</td>
                        <td className="tabular px-3 py-2.5 text-right">{r.n}</td>
                        <td className="tabular px-3 py-2.5 text-right">{r.p}</td>
                        <td className="tabular px-3 py-2.5 text-right">{r.k}</td>
                        <td className="tabular px-3 py-2.5 text-right">{r.nonce.toString()}</td>
                        <td className="tabular px-3 py-2.5 font-mono text-xs">{r.blockNumber.toString()}</td>
                        <td className="px-3 py-2.5">
                          <HashText value={r.payloadHash} chars={5} />
                        </td>
                        <td className="px-3 py-2.5">{ledger.evidence.get(r.deviceLabel, r.nonce) ? <Badge tone="success">stored</Badge> : <Badge>hash only</Badge>}</td>
                        <td className="px-5 py-2.5">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="ghost" icon={<Eye className="size-3.5" />} onClick={() => setInspect(r)}>
                              Inspect
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      <InspectModal reading={inspect} onClose={() => setInspect(null)} />
    </>
  );
}
