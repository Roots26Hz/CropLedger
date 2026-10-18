import { CheckCircle2, Cpu, ExternalLink, FlaskConical, Pause, Play, Radio, Send, Sparkles, Trash2, XCircle, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { ANOMALY_DESCRIPTIONS, type AnomalyKind } from "@core/deviceSimulator.js";
import { explorerTxUrl } from "@core/networks.js";
import { PageHeader } from "../components/layout/PageHeader";
import { NpkTrendChart } from "../components/NpkTrendChart";
import { FAILURE_STAGES, StageBadge } from "../components/StageBadge";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Callout } from "../components/ui/Callout";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { Field, Select } from "../components/ui/Field";
import { InfoTip } from "../components/ui/Tooltip";
import { useRoute } from "../hooks/useRoute";
import { useLedger } from "../state/LedgerContext";
import { useSettings } from "../state/SettingsContext";
import { useSimulator } from "../state/SimulatorContext";
import { useToast } from "../state/ToastContext";
import { cn } from "../utils/cn";
import { fmt, formatClock } from "../utils/format";

const INTERVALS = [2, 5, 10, 30];
const ANOMALIES: { kind: AnomalyKind; label: string }[] = [
  { kind: "spike", label: "Spike" },
  { kind: "drift", label: "Drift" },
  { kind: "dropout", label: "Dropout" },
];

function Toggle({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; id: string }) {
  return (
    <label htmlFor={id} className="inline-flex cursor-pointer items-center gap-2 text-sm">
      <span className="relative inline-flex">
        <input id={id} type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-5 w-9 rounded-full bg-line-strong transition-colors peer-checked:bg-forest-600 peer-focus-visible:ring-2 peer-focus-visible:ring-forest-300" />
        <span className="absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
      </span>
      {label}
    </label>
  );
}

export function LiveFeedPage() {
  const { settings } = useSettings();
  const ledger = useLedger();
  const sim = useSimulator();
  const { navigate } = useRoute();
  const { notify } = useToast();
  const [generating, setGenerating] = useState(false);
  const isLocal = settings.mode === "local";

  const selectedDevice = sim.devices.find((d) => d.label === sim.selected);
  const txById = useMemo(() => new Map(ledger.txs.map((t) => [t.id, t])), [ledger.txs]);
  const deviceFeed = useMemo(() => sim.feed.filter((f) => f.deviceLabel === sim.selected), [sim.feed, sim.selected]);
  const chartData = useMemo(
    () =>
      deviceFeed
        .slice(0, 40)
        .reverse()
        .map((f) => ({ x: f.payload.nonce, t: f.payload.timestamp * 1000, n: f.payload.n, p: f.payload.p, k: f.payload.k, anomaly: f.payload.anomalyLabel === "anomaly" })),
    [deviceFeed],
  );
  const queued = sim.feed.filter((f) => !f.txId);

  const generate = async (count: number) => {
    setGenerating(true);
    try {
      await sim.generate(count);
    } catch (e) {
      notify({ tone: "error", title: "Could not generate reading", message: (e as Error).message });
    } finally {
      setGenerating(false);
    }
  };

  const canSimulate = Boolean(selectedDevice && ledger.service);
  const simBlocker = !ledger.service
    ? "Configure a contract or switch to local demo mode."
    : !selectedDevice
      ? "Create a simulated device in the Device Registry first."
      : undefined;

  return (
    <>
      <PageHeader
        title="Live Sensor Feed"
        description="The simulated edge device samples N, P, K, moisture, temperature and pH, runs its on-board anomaly model, builds the canonical payload, signs it with its device key and hands it to the gateway."
      />

      {sim.devices.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Cpu className="size-5" />}
            title="No simulated devices in this browser"
            action={
              <Button icon={<Cpu className="size-4" />} onClick={() => navigate("devices")}>
                Go to Device Registry
              </Button>
            }
          >
            Register a simulated device first. Its signing key is generated and kept in this browser.
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card className="mb-6">
            <CardHeader title="Edge simulator" subtitle={selectedDevice ? `${selectedDevice.label} in ${selectedDevice.fieldLabel}` : undefined} icon={<Radio className="size-4" />}
              actions={sim.running ? <Badge tone="success" dot pulse>Streaming every {sim.intervalSec}s</Badge> : <Badge>Stopped</Badge>}
            />
            <CardBody className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Device" htmlFor="feed-device">
                  <Select id="feed-device" value={sim.selected ?? ""} onChange={(e) => sim.setSelected(e.target.value)}>
                    {sim.devices.map((d) => (
                      <option key={d.label} value={d.label}>
                        {d.label} · {d.fieldLabel}
                        {!d.registered ? " (not registered)" : !d.active ? " (revoked)" : ""}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Interval" htmlFor="feed-interval">
                  <Select id="feed-interval" value={sim.intervalSec} onChange={(e) => sim.setIntervalSec(Number(e.target.value))}>
                    {INTERVALS.map((s) => (
                      <option key={s} value={s}>
                        every {s} s
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="flex items-end gap-2 sm:col-span-2">
                  {sim.running ? (
                    <Button variant="outline" icon={<Pause className="size-4" />} onClick={sim.stop}>
                      Stop
                    </Button>
                  ) : (
                    <Button icon={<Play className="size-4" />} onClick={sim.start} disabled={!canSimulate} disabledReason={simBlocker}>
                      Start
                    </Button>
                  )}
                  <Button variant="secondary" icon={<Sparkles className="size-4" />} loading={generating} onClick={() => void generate(1)} disabled={!canSimulate} disabledReason={simBlocker}>
                    One reading
                  </Button>
                  <Button variant="outline" onClick={() => void generate(5)} disabled={!canSimulate || generating} disabledReason={simBlocker}>
                    Burst × 5
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex items-center gap-1 text-xs font-medium text-ink-muted">
                    <Zap className="size-3.5" /> Inject anomaly
                    <InfoTip>Anomalies are genuine device reports of unusual values. The edge model flags them; the ledger still records them faithfully.</InfoTip>
                  </span>
                  {ANOMALIES.map((a) => (
                    <Button
                      key={a.kind}
                      size="sm"
                      variant={sim.pendingAnomaly === a.kind ? "secondary" : "outline"}
                      title={ANOMALY_DESCRIPTIONS[a.kind]}
                      disabled={!canSimulate}
                      disabledReason={simBlocker}
                      onClick={() => sim.injectAnomaly(a.kind)}
                    >
                      {a.label}
                    </Button>
                  ))}
                  {sim.pendingAnomaly && <Badge tone="warning">next reading: {sim.pendingAnomaly}</Badge>}
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <Toggle id="auto-submit" checked={sim.autoSubmit} onChange={sim.setAutoSubmit} label="Auto-submit to ledger" />
                  <Button
                    size="sm"
                    icon={<Send className="size-3.5" />}
                    disabled={queued.length === 0 || Boolean(ledger.writeBlocker)}
                    disabledReason={queued.length === 0 ? "No signed readings waiting" : (ledger.writeBlocker ?? undefined)}
                    onClick={() => void sim.submitAllQueued()}
                  >
                    Submit queued ({queued.length})
                  </Button>
                </div>
              </div>

              {!isLocal && sim.autoSubmit && (
                <Callout tone="info">
                  Auto-submit is on: MetaMask will ask you to approve a transaction for every generated reading. Nothing is sent without your approval.
                </Callout>
              )}
              {!isLocal && ledger.writeBlocker && (
                <Callout tone="warning">
                  Readings can be generated and signed now, but submitting them needs a wallet: {ledger.writeBlocker}
                </Callout>
              )}
              {selectedDevice && !selectedDevice.registered && (
                <Callout tone="warning">This device is not registered on the current ledger, so its readings will be rejected as an unregistered device.</Callout>
              )}
              {selectedDevice?.registered && !selectedDevice.active && (
                <Callout tone="warning">This device has been revoked. New readings will be rejected; its history remains retrievable.</Callout>
              )}
            </CardBody>
          </Card>

          <Card className="mb-6">
            <CardHeader title="Live readings" subtitle={`${selectedDevice?.label ?? ""} · newest ${chartData.length} readings from this browser's simulator`} />
            <CardBody>
              {chartData.length > 1 ? (
                <NpkTrendChart data={chartData} height={160} />
              ) : (
                <EmptyState title="Waiting for readings">Press “One reading” or “Start”.</EmptyState>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Reading feed"
              subtitle="Signed payloads and their submission status (newest first)"
              actions={
                sim.feed.length > 0 && (
                  <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={sim.clearFeed} title="Clears this list only; the ledger and stored payloads are not affected">
                    Clear list
                  </Button>
                )
              }
            />
            {sim.feed.length === 0 ? (
              <EmptyState title="No readings yet" />
            ) : (
              <div className="scrollbar-thin overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-ink-muted">
                      <th className="px-5 py-2.5 font-medium">Time</th>
                      <th className="px-3 py-2.5 font-medium">Device · field</th>
                      <th className="px-3 py-2.5 text-right font-medium">N</th>
                      <th className="px-3 py-2.5 text-right font-medium">P</th>
                      <th className="px-3 py-2.5 text-right font-medium">K</th>
                      <th className="px-3 py-2.5 font-medium">Moisture · pH</th>
                      <th className="px-3 py-2.5 font-medium">Edge AI</th>
                      <th className="px-3 py-2.5 font-medium">Signature</th>
                      <th className="px-3 py-2.5 font-medium">Ledger status</th>
                      <th className="px-5 py-2.5 text-right font-medium" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {sim.feed.slice(0, 60).map((f) => {
                      const tx = f.txId ? txById.get(f.txId) : undefined;
                      const url = tx?.txHash && tx.chainId ? explorerTxUrl(tx.chainId, tx.txHash) : undefined;
                      const retryable = tx && FAILURE_STAGES.includes(tx.stage) && tx.stage !== "rejected-preflight";
                      return (
                        <tr key={f.id} className={cn(f.payload.anomalyLabel === "anomaly" && "bg-danger-50/40")}>
                          <td className="tabular px-5 py-2.5 text-xs text-ink-muted">
                            {formatClock(f.payload.timestamp * 1000)}
                            <div className="text-ink-faint">nonce {f.payload.nonce}</div>
                          </td>
                          <td className="px-3 py-2.5">
                            <p className="font-medium">{f.deviceLabel}</p>
                            <p className="text-xs text-ink-faint">{f.fieldLabel}</p>
                          </td>
                          <td className="tabular px-3 py-2.5 text-right font-medium">{f.payload.n}</td>
                          <td className="tabular px-3 py-2.5 text-right font-medium">{f.payload.p}</td>
                          <td className="tabular px-3 py-2.5 text-right font-medium">{f.payload.k}</td>
                          <td className="tabular px-3 py-2.5 text-xs text-ink-muted">
                            {fmt.moisture(f.payload.soilMoistureBp)} · {fmt.ph(f.payload.phCenti)}
                          </td>
                          <td className="px-3 py-2.5">
                            {f.payload.anomalyLabel === "anomaly" ? (
                              <Badge tone="danger" dot>anomaly {fmt.score(f.payload.anomalyScoreMilli)}</Badge>
                            ) : (
                              <Badge tone="neutral">normal {fmt.score(f.payload.anomalyScoreMilli)}</Badge>
                            )}
                            {f.injected && <p className="mt-0.5 text-[11px] text-ink-faint">injected: {f.injected}</p>}
                          </td>
                          <td className="px-3 py-2.5">
                            {f.signatureValid ? (
                              <span className="inline-flex items-center gap-1 text-xs text-forest-700" title="EIP-712 signature recovers to the device key">
                                <CheckCircle2 className="size-3.5" /> signed
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs text-danger-600">
                                <XCircle className="size-3.5" /> invalid
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            {tx ? (
                              <div className="space-y-0.5">
                                <StageBadge stage={tx.stage} local={tx.local} />
                                {tx.error && <p className="max-w-56 text-[11px] leading-snug text-danger-600">{tx.error.message}</p>}
                                {tx.blockNumber !== undefined && (
                                  <p className="tabular text-[11px] text-ink-faint">
                                    {tx.local ? "simulated block" : "block"} {tx.blockNumber}
                                  </p>
                                )}
                              </div>
                            ) : (
                              <Badge tone="neutral">Signed · not submitted</Badge>
                            )}
                          </td>
                          <td className="px-5 py-2.5">
                            <div className="flex justify-end gap-1">
                              {(!tx || retryable) && (
                                <Button size="sm" variant="secondary" icon={<Send className="size-3.5" />} disabled={Boolean(ledger.writeBlocker)} disabledReason={ledger.writeBlocker ?? undefined} onClick={() => void sim.submitItem(f.id)}>
                                  {tx ? "Retry" : "Submit"}
                                </Button>
                              )}
                              {url && (
                                <a href={url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-chain-600 hover:bg-chain-50" title="Open in PolygonScan (Amoy)">
                                  Tx <ExternalLink className="size-3" />
                                </a>
                              )}
                              {tx?.stage === "confirmed" && tx.readingIndex !== undefined && (
                                <Button size="sm" variant="ghost" icon={<FlaskConical className="size-3.5" />} onClick={() => navigate("lab", { device: f.deviceLabel, index: tx.readingIndex })}>
                                  Verify
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </>
  );
}
