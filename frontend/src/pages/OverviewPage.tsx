import {
  Activity,
  ArrowRight,
  Boxes,
  Cpu,
  FileCheck2,
  Fingerprint,
  Globe,
  Radio,
  ShieldAlert,
  Sprout,
  Wallet,
} from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { HARDHAT_LOCAL, chainLabel, explorerAddressUrl, explorerTxUrl, getNetwork, topUpHint } from "@core/networks.js";
import { PageHeader } from "../components/layout/PageHeader";
import { NpkTrendChart } from "../components/NpkTrendChart";
import { FAILURE_STAGES, StageBadge } from "../components/StageBadge";
import { StatCard } from "../components/StatCard";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { HashText } from "../components/ui/HashText";
import { Spinner } from "../components/ui/Spinner";
import { useLedgerReadings } from "../hooks/useLedgerReadings";
import { useRoute } from "../hooks/useRoute";
import { useLedger } from "../state/LedgerContext";
import { useSettings } from "../state/SettingsContext";
import { useSimulator } from "../state/SimulatorContext";
import { useWallet } from "../state/WalletContext";
import { APPROX_READING_COST_WEI, formatDateTime, formatNative, relativeTime } from "../utils/format";

function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 text-sm">
      <dt className="shrink-0 text-ink-muted">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

function GettingStarted() {
  const { navigate } = useRoute();
  const steps = [
    { icon: <Cpu className="size-4" />, title: "Register a simulated device", text: "Generate a device key and register it in the ledger.", to: "devices" },
    { icon: <Radio className="size-4" />, title: "Stream signed readings", text: "Start the edge simulator; each reading is signed and submitted.", to: "feed" },
    { icon: <FileCheck2 className="size-4" />, title: "Verify and tamper", text: "Recompute a payload hash, then alter one value and watch it fail.", to: "lab" },
  ];
  return (
    <Card>
      <CardHeader title="Start the demonstration" subtitle="Three steps from an empty ledger to a tamper-detection result" icon={<Sprout className="size-4" />} />
      <CardBody className="grid gap-3 md:grid-cols-3">
        {steps.map((s, i) => (
          <button
            key={s.to}
            type="button"
            onClick={() => navigate(s.to)}
            className="group flex flex-col gap-2 rounded-lg border border-line bg-surface-2 p-4 text-left transition-colors hover:border-forest-300 hover:bg-forest-50"
          >
            <span className="flex items-center gap-2 text-xs font-semibold text-forest-700">
              <span className="flex size-6 items-center justify-center rounded-full bg-forest-600 text-white">{i + 1}</span>
              {s.icon}
            </span>
            <span className="text-sm font-semibold">{s.title}</span>
            <span className="text-[13px] text-ink-muted">{s.text}</span>
            <span className="mt-auto inline-flex items-center gap-1 text-xs font-medium text-forest-700 group-hover:underline">
              Open <ArrowRight className="size-3" />
            </span>
          </button>
        ))}
      </CardBody>
    </Card>
  );
}

export function OverviewPage() {
  const { settings, networkConfigured } = useSettings();
  const wallet = useWallet();
  const ledger = useLedger();
  const { feed } = useSimulator();
  const { navigate } = useRoute();
  const { readings, loading } = useLedgerReadings();
  const isLocal = settings.mode === "local";
  const network = getNetwork(settings.chainId);

  const active = ledger.devices.filter((d) => d.active).length;
  const myTxs = ledger.txs;
  const confirmed = myTxs.filter((t) => t.stage === "confirmed").length;
  const failed = myTxs.filter((t) => FAILURE_STAGES.includes(t.stage)).length;
  const latest = readings.at(-1);
  const latestPayload = latest ? ledger.evidence.get(latest.deviceLabel, latest.nonce) : undefined;

  // Trend device: the active device with the most recent reading among those
  // with enough history (falls back to the overall latest reading's device).
  const trendDevice = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of readings) counts.set(r.deviceId, (counts.get(r.deviceId) ?? 0) + 1);
    const activeIds = new Set(ledger.devices.filter((d) => d.active).map((d) => d.deviceId));
    const candidate = [...readings].reverse().find((r) => activeIds.has(r.deviceId) && (counts.get(r.deviceId) ?? 0) >= 2);
    return candidate ?? latest;
  }, [readings, ledger.devices, latest]);

  const trend = useMemo(() => {
    if (!trendDevice) return [];
    const anomalies = new Set(feed.filter((f) => f.payload.anomalyLabel === "anomaly").map((f) => `${f.deviceLabel}#${f.payload.nonce}`));
    return readings
      .filter((r) => r.deviceId === trendDevice.deviceId)
      .slice(-40)
      .map((r) => ({
        x: Number(r.nonce),
        t: Number(r.timestamp) * 1000,
        n: r.n,
        p: r.p,
        k: r.k,
        anomaly: anomalies.has(`${r.deviceLabel}#${r.nonce}`) || ledger.evidence.get(r.deviceLabel, r.nonce)?.payload.anomalyLabel === "anomaly",
      }));
  }, [readings, trendDevice, feed, ledger.evidence]);

  return (
    <>
      <PageHeader
        title="Overview"
        description="Soil nutrient readings from simulated edge devices, anchored as tamper-evident, device-signed records."
        actions={
          <Button variant="secondary" icon={<Radio className="size-4" />} onClick={() => navigate("feed")}>
            Live sensor feed
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Registered devices"
          value={ledger.devices.length}
          detail={`${active} active · ${ledger.devices.length - active} revoked`}
          icon={<Cpu className="size-4" />}
          tip="Devices whose signing address the owner registered in the contract. Revoked devices keep their history."
        />
        <StatCard
          label={isLocal ? "Readings (local ledger)" : "Readings on-chain"}
          value={ledger.totalReadings.toLocaleString()}
          detail={isLocal ? "simulated, not on a blockchain" : `from contract totalReadings()`}
          icon={<Boxes className="size-4" />}
        />
        <StatCard
          label={isLocal ? "Recorded operations" : "Confirmed transactions"}
          value={confirmed}
          detail="started from this browser"
          icon={<FileCheck2 className="size-4" />}
          tip={isLocal ? "Local demo operations accepted by the in-browser ledger." : "Transactions with a successful receipt, sent from this browser."}
        />
        <StatCard
          label="Failed / rejected"
          value={failed}
          detail="replays, invalid signatures, wallet rejections…"
          icon={<ShieldAlert className="size-4" />}
          tone="danger"
        />
      </div>

      {ledger.devices.length === 0 && ledger.status !== "loading" && (
        <div className="mb-6">
          <GettingStarted />
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Nutrient trend"
            subtitle={trendDevice ? `${trendDevice.deviceLabel} · ${trendDevice.fieldLabel} · last ${trend.length} recorded readings (x axis: device nonce)` : "Recorded readings will appear here"}
            icon={<Activity className="size-4" />}
            actions={loading && <Spinner />}
          />
          <CardBody>
            {trend.length > 1 ? (
              <>
                <NpkTrendChart data={trend} height={230} />
                <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-faint">
                  <span className="size-2.5 rounded-full border-2 border-surface bg-danger-500 ring-1 ring-danger-100" /> Red points: readings the edge
                  model labelled as anomalies. They are still genuine, signed device reports.
                </p>
              </>
            ) : (
              <EmptyState icon={<Activity className="size-5" />} title="Not enough readings yet">
                Record at least two readings to see a trend.
              </EmptyState>
            )}
          </CardBody>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Network" icon={<Globe className="size-4" />} />
            <CardBody className="py-2">
              <dl className="divide-y divide-line">
                <KeyValue label="Mode">{isLocal ? <Badge tone="local">Local demo</Badge> : <Badge tone="info">Blockchain</Badge>}</KeyValue>
                {!isLocal && (
                  <>
                    <KeyValue label="Network">{network?.name ?? chainLabel(settings.chainId)}</KeyValue>
                    <KeyValue label="Chain ID">
                      <span className="tabular font-mono text-xs">{settings.chainId}</span>
                    </KeyValue>
                    <KeyValue label="Contract">
                      {networkConfigured ? (
                        <HashText value={settings.contractAddress} href={explorerAddressUrl(settings.chainId, settings.contractAddress)} />
                      ) : (
                        <Badge tone="warning">not set</Badge>
                      )}
                    </KeyValue>
                    <KeyValue label="Latest block">
                      <span className="tabular font-mono text-xs">{ledger.blockNumber?.toLocaleString() ?? "—"}</span>
                    </KeyValue>
                  </>
                )}
                <KeyValue label="Owner">{ledger.owner ? isLocal ? <span className="text-xs">Local operator</span> : <HashText value={ledger.owner} /> : "—"}</KeyValue>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Wallet" icon={<Wallet className="size-4" />} />
            <CardBody className="py-2">
              <dl className="divide-y divide-line">
                <KeyValue label="Status">
                  {wallet.status === "connected" ? (
                    <Badge tone="success" dot>Connected</Badge>
                  ) : wallet.status === "unavailable" ? (
                    <Badge>No wallet</Badge>
                  ) : (
                    <Badge tone="warning">Not connected</Badge>
                  )}
                </KeyValue>
                <KeyValue label="Account">{wallet.account ? <HashText value={wallet.account} /> : "—"}</KeyValue>
                {!isLocal && ledger.walletBalance !== null && (
                  <KeyValue label="Balance">
                    <span className="tabular text-xs">
                      {formatNative(ledger.walletBalance, network?.nativeCurrency.symbol ?? "ETH")}{" "}
                      {ledger.walletBalance < APPROX_READING_COST_WEI * 3n && (
                        <Badge tone="warning" title={`${topUpHint(network?.chainId ?? 0, wallet.account ?? undefined)}.`}>
                          low — {network?.chainId === HARDHAT_LOCAL.chainId ? "run npm run fund:local" : "use a faucet"}
                        </Badge>
                      )}
                    </span>
                  </KeyValue>
                )}
                <KeyValue label="Wallet network">
                  {wallet.chainId ? (
                    <span className="text-xs">
                      {chainLabel(wallet.chainId)}{" "}
                      {!isLocal && wallet.chainId !== settings.chainId && <Badge tone="danger">wrong network</Badge>}
                    </span>
                  ) : (
                    "—"
                  )}
                </KeyValue>
              </dl>
              {isLocal && <p className="pb-2 text-xs text-ink-faint">A wallet is not needed in local demo mode.</p>}
            </CardBody>
          </Card>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Latest reading"
            icon={<Fingerprint className="size-4" />}
            actions={
              latest && (
                <Button size="sm" variant="secondary" onClick={() => navigate("lab", { device: latest.deviceLabel, index: latest.index })}>
                  Verify
                </Button>
              )
            }
          />
          <CardBody>
            {latest ? (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  {(["n", "p", "k"] as const).map((key) => (
                    <div key={key} className="rounded-lg bg-surface-2 p-3">
                      <p className="flex items-center gap-1.5 text-xs text-ink-muted">
                        <span className="size-2 rounded-full" style={{ background: `var(--color-npk-${key})` }} />
                        {key.toUpperCase()} mg/kg
                      </p>
                      <p className="tabular mt-1 text-xl font-semibold">{latest[key]}</p>
                    </div>
                  ))}
                </div>
                <dl className="divide-y divide-line">
                  <KeyValue label="Device · field">
                    {latest.deviceLabel} · {latest.fieldLabel}
                  </KeyValue>
                  <KeyValue label="Sampled">{formatDateTime(latest.timestamp)}</KeyValue>
                  <KeyValue label="Nonce · index">
                    <span className="tabular">
                      {latest.nonce.toString()} · #{latest.index}
                    </span>
                  </KeyValue>
                  <KeyValue label={isLocal ? "Simulated block" : "Block"}>
                    <span className="tabular font-mono text-xs">{latest.blockNumber.toString()}</span>
                  </KeyValue>
                  <KeyValue label="Payload hash">
                    <HashText value={latest.payloadHash} />
                  </KeyValue>
                  <KeyValue label="Off-chain payload">
                    {latestPayload ? <Badge tone="success">stored in this browser</Badge> : <Badge>not in this browser</Badge>}
                  </KeyValue>
                </dl>
              </div>
            ) : (
              <EmptyState icon={<Fingerprint className="size-5" />} title="No readings recorded yet">
                Generate readings in the Live Sensor Feed.
              </EmptyState>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Recent activity"
            subtitle="Operations started from this browser"
            icon={<Activity className="size-4" />}
            actions={myTxs.length > 0 && <Button size="sm" variant="ghost" onClick={() => navigate("transactions")}>View all</Button>}
          />
          <CardBody className="p-0">
            {myTxs.length === 0 ? (
              <EmptyState title="No activity yet">Registrations, submissions and attack attempts will be listed here.</EmptyState>
            ) : (
              <ul className="divide-y divide-line">
                {myTxs.slice(0, 7).map((t) => {
                  const url = t.txHash && t.chainId ? explorerTxUrl(t.chainId, t.txHash) : undefined;
                  return (
                    <li key={t.id} className="flex items-center gap-3 px-5 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{t.label}</p>
                        <p className="text-xs text-ink-faint">
                          {relativeTime(t.updatedAt)}
                          {t.txHash && (
                            <>
                              {" · "}
                              <HashText value={t.txHash} chars={5} copy={false} href={url} />
                            </>
                          )}
                          {t.localRef && <span className="font-mono"> · {t.localRef}</span>}
                        </p>
                      </div>
                      <StageBadge stage={t.stage} local={t.local} />
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
