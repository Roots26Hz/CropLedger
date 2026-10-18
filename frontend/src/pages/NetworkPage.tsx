/**
 * Network & Consensus view.
 *
 * The lifecycle pipeline and the recent-blocks table use real data from this
 * browser's operation log and the RPC node. The validator animation is purely
 * illustrative and is labelled as such: the dashboard does not take part in,
 * or independently verify, Polygon consensus.
 */
import { Blocks, CheckCircle2, Cpu, FileCode2, Hourglass, Network, Radio, Router, Server, XCircle } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { explorerBlockUrl, explorerTxUrl, getNetwork } from "@core/networks.js";
import type { SubmissionStage } from "@core/gateway.js";
import { PageHeader } from "../components/layout/PageHeader";
import { StageBadge } from "../components/StageBadge";
import { Badge } from "../components/ui/Badge";
import { Callout } from "../components/ui/Callout";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { Select } from "../components/ui/Field";
import { HashText } from "../components/ui/HashText";
import { useLedger } from "../state/LedgerContext";
import { useSettings } from "../state/SettingsContext";
import type { BlockSummary, TxRecord } from "../types/app";
import { cn } from "../utils/cn";
import { formatClock, relativeTime } from "../utils/format";

type NodeState = "done" | "active" | "failed" | "waiting";

interface PipelineNode {
  key: string;
  title: string;
  icon: ReactNode;
  state: NodeState;
  time?: number;
  detail: ReactNode;
}

const FAILED_AT: Partial<Record<SubmissionStage, string>> = {
  "rejected-preflight": "gateway",
  "wallet-rejected": "rpc",
  failed: "gateway",
  reverted: "event",
};

function stageTime(tx: TxRecord, stage: SubmissionStage): number | undefined {
  return tx.stages.find((s) => s.stage === stage)?.at;
}

function buildPipeline(tx: TxRecord, latestBlock: number | null, blockTime: number | null): PipelineNode[] {
  const reached = new Set(tx.stages.map((s) => s.stage));
  const failedAt = FAILED_AT[tx.stage];
  const confirmations = tx.blockNumber !== undefined && latestBlock !== null && !tx.local ? Math.max(0, latestBlock - tx.blockNumber + 1) : null;
  const confirmed = tx.stage === "confirmed";
  // Rejected before reaching the chain: later steps were never reached.
  const stoppedEarly = tx.stage === "rejected-preflight" || tx.stage === "wallet-rejected" || (tx.stage === "failed" && !tx.txHash);
  const notReached = "Not reached";
  const nodes: PipelineNode[] = [
    {
      key: "device",
      title: "Edge device",
      icon: <Cpu className="size-4" />,
      state: "done",
      time: tx.createdAt,
      detail: tx.kind === "submitReading" || tx.kind === "attack" ? "Payload hashed and signed (EIP-712)" : "Registry action prepared",
    },
    {
      key: "gateway",
      title: "Gateway",
      icon: <Router className="size-4" />,
      state: failedAt === "gateway" ? "failed" : reached.has("preflight") || reached.has("awaiting-wallet") ? "done" : "active",
      time: stageTime(tx, "preflight") ?? stageTime(tx, "validating"),
      detail:
        failedAt === "gateway"
          ? (tx.error?.name ?? "Rejected before broadcast")
          : tx.local
            ? "Rules checked on a copy of the ledger"
            : reached.has("preflight")
              ? "Validated + eth_call preflight"
              : "Validated; preflight skipped (broadcast forced)",
    },
    {
      key: "rpc",
      title: tx.local ? "Local ledger" : "RPC node",
      icon: <Server className="size-4" />,
      state: failedAt === "rpc" ? "failed" : reached.has("submitted") ? "done" : reached.has("awaiting-wallet") ? "active" : "waiting",
      time: stageTime(tx, "awaiting-wallet"),
      detail:
        failedAt === "rpc"
          ? "Rejected in the wallet"
          : tx.local
            ? "No RPC — in-browser"
            : reached.has("submitted")
              ? "Signed by MetaMask, broadcast"
              : stoppedEarly
                ? notReached
                : "Waiting for wallet approval",
    },
    {
      key: "pending",
      title: "Pending",
      icon: <Hourglass className="size-4" />,
      state: reached.has("submitted") ? (tx.blockNumber !== undefined || tx.stage === "reverted" ? "done" : "active") : "waiting",
      time: stageTime(tx, "submitted"),
      detail: tx.txHash ? <HashText value={tx.txHash} chars={4} copy={false} /> : tx.localRef ? <span className="font-mono">{tx.localRef}</span> : "Not broadcast",
    },
    {
      key: "block",
      title: tx.local ? "Simulated block" : "Block inclusion",
      icon: <Blocks className="size-4" />,
      state: tx.blockNumber !== undefined ? "done" : reached.has("submitted") ? "active" : "waiting",
      time: blockTime ?? undefined,
      detail: tx.blockNumber !== undefined ? `Block ${tx.blockNumber}${tx.local ? " (simulated)" : ""}` : stoppedEarly ? notReached : "—",
    },
    {
      key: "confirm",
      title: "Confirmation",
      icon: <CheckCircle2 className="size-4" />,
      state: confirmed ? "done" : tx.stage === "reverted" ? "failed" : reached.has("submitted") ? "active" : "waiting",
      time: stageTime(tx, "confirmed") ?? stageTime(tx, "reverted"),
      detail: confirmed
        ? confirmations !== null
          ? `${confirmations} confirmation${confirmations === 1 ? "" : "s"}`
          : "Receipt status 1"
        : tx.stage === "reverted"
          ? "Receipt status 0 (reverted)"
          : stoppedEarly
            ? notReached
            : "Waiting for receipt",
    },
    {
      key: "event",
      title: "Contract event",
      icon: <FileCode2 className="size-4" />,
      state: confirmed ? "done" : failedAt === "event" ? "failed" : "waiting",
      detail: confirmed
        ? tx.kind === "registerDevice"
          ? "DeviceRegistered"
          : tx.kind === "revokeDevice"
            ? "DeviceRevoked"
            : `ReadingRecorded${tx.readingIndex !== undefined ? ` (index ${tx.readingIndex})` : ""}`
        : failedAt === "event"
          ? "No event (reverted)"
          : stoppedEarly
            ? notReached
            : "—",
    },
  ];
  return nodes;
}

const nodeStyles: Record<NodeState, string> = {
  done: "border-forest-300 bg-forest-50 text-forest-700",
  active: "border-chain-500 bg-chain-50 text-chain-700 ring-2 ring-chain-100",
  failed: "border-danger-500 bg-danger-50 text-danger-700",
  waiting: "border-line bg-surface-2 text-ink-faint",
};

function Pipeline({ nodes }: { nodes: PipelineNode[] }) {
  return (
    <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
      {nodes.map((node, i) => (
        <li key={node.key} className={cn("relative rounded-xl border p-3 transition-colors", nodeStyles[node.state])}>
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-semibold">
              {node.icon}
              {node.title}
            </span>
            {node.state === "done" && <CheckCircle2 className="size-3.5" />}
            {node.state === "failed" && <XCircle className="size-3.5" />}
            {node.state === "active" && <span className="size-2 animate-pulse-soft rounded-full bg-chain-500" />}
          </div>
          <div className="mt-2 min-h-8 text-[12px] leading-snug text-ink-muted">{node.detail}</div>
          <p className="tabular mt-1 text-[11px] text-ink-faint">{node.time ? formatClock(node.time) : " "}</p>
          <span className="absolute -top-2 -left-2 flex size-5 items-center justify-center rounded-full bg-surface text-[10px] font-semibold text-ink-muted ring-1 ring-line">{i + 1}</span>
        </li>
      ))}
    </ol>
  );
}

/** Purely illustrative proposer rotation (clearly labelled in the UI). */
function ConsensusIllustration() {
  const [step, setStep] = useState(0);
  const validators = 7;
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) setStep((s) => s + 1);
    }, 1600);
    return () => clearInterval(timer);
  }, []);
  const proposer = step % validators;
  const votes = Math.min(validators, 1 + ((step * 3) % (validators + 2)));
  return (
    <div className="flex flex-col items-center gap-4 2xl:flex-row">
      <svg viewBox="0 0 220 220" className="size-48 shrink-0" role="img" aria-label="Illustrative animation of validators taking turns to propose blocks">
        <circle cx="110" cy="110" r="78" fill="none" stroke="var(--color-line)" strokeDasharray="4 6" />
        {(() => {
          const angle = (proposer / validators) * Math.PI * 2 - Math.PI / 2;
          return <line x1={110 + 78 * Math.cos(angle)} y1={110 + 78 * Math.sin(angle)} x2="110" y2="110" stroke="var(--color-chain-500)" strokeWidth="2" />;
        })()}
        <rect x="88" y="88" width="44" height="44" rx="8" fill="var(--color-forest-50)" stroke="var(--color-forest-300)" />
        <text x="110" y="114" textAnchor="middle" fontSize="11" fill="var(--color-forest-700)" fontFamily="var(--font-mono)">
          block
        </text>
        {Array.from({ length: validators }, (_, i) => {
          const angle = (i / validators) * Math.PI * 2 - Math.PI / 2;
          const x = 110 + 78 * Math.cos(angle);
          const y = 110 + 78 * Math.sin(angle);
          const isProposer = i === proposer;
          const voted = (i - proposer + validators) % validators < votes;
          return (
            <g key={i}>
              <circle cx={x} cy={y} r={isProposer ? 13 : 10} fill={isProposer ? "var(--color-chain-500)" : voted ? "var(--color-forest-400)" : "var(--color-surface)"} stroke={isProposer ? "var(--color-surface)" : "var(--color-line-strong)"} strokeWidth="2" />
              <text x={x} y={y + 3.5} textAnchor="middle" fontSize="9" fill={isProposer || voted ? "#fff" : "var(--color-ink-faint)"} fontFamily="var(--font-sans)">
                V{i + 1}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="space-y-2 text-[13px] text-ink-muted">
        <Badge tone="warning" className="whitespace-normal!">Illustrative · simulated animation, not live validator data</Badge>
        <p>
          On Polygon PoS, block producers (the Bor layer) create blocks and a staked validator set (the Heimdall layer) agrees on them and periodically checkpoints
          them to Ethereum (Sepolia, for the Amoy testnet).
        </p>
        <p>
          This dashboard does <strong>not</strong> run or verify consensus. It observes the outcome through an RPC node: a transaction hash, the block that
          includes it, its receipt and the confirmations that follow.
        </p>
        <p className="text-xs text-ink-faint">
          Blue: current proposer · green: validators that have attested in this illustration.
        </p>
      </div>
    </div>
  );
}

export function NetworkPage() {
  const { settings } = useSettings();
  const ledger = useLedger();
  const isLocal = settings.mode === "local";
  const network = getNetwork(settings.chainId);
  const candidates = useMemo(() => ledger.txs.filter((t) => t.kind !== "attack" || t.txHash || t.localRef || t.stages.length > 0), [ledger.txs]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const fallback = candidates.find((t) => t.kind === "submitReading" && t.stage === "confirmed") ?? candidates[0] ?? null;
  const tx = candidates.find((t) => t.id === selectedId) ?? fallback;
  const [blocks, setBlocks] = useState<BlockSummary[]>([]);
  const [blockTime, setBlockTime] = useState<number | null>(null);
  const [blockError, setBlockError] = useState<string | null>(null);

  // Real recent blocks from the RPC node (network mode only).
  useEffect(() => {
    const svc = ledger.service;
    if (!svc?.getRecentBlocks) {
      setBlocks([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      if (document.hidden) return;
      try {
        const recent = await svc.getRecentBlocks!(8);
        if (!cancelled) {
          setBlocks(recent);
          setBlockError(null);
        }
      } catch (e) {
        if (!cancelled) setBlockError((e as Error).message);
      }
    };
    void load();
    const timer = setInterval(load, 6000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [ledger.service]);

  // Timestamp of the block that included the selected transaction.
  useEffect(() => {
    setBlockTime(null);
    const svc = ledger.service;
    if (!tx || tx.local || tx.blockNumber === undefined || !svc?.getBlock) return;
    let cancelled = false;
    svc
      .getBlock(tx.blockNumber)
      .then((b) => !cancelled && b && setBlockTime(b.timestamp * 1000))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [tx, ledger.service]);

  const ourBlocks = new Set(ledger.txs.filter((t) => !t.local && t.blockNumber !== undefined).map((t) => t.blockNumber));

  return (
    <>
      <PageHeader
        title="Network & Consensus"
        description="Follow a reading from the device to a confirmed contract event, and watch the blocks the network is producing."
      />

      {isLocal && (
        <Callout tone="warning" className="mb-6" title="Everything on this page is simulated in local demo mode">
          The lifecycle below shows the local demo ledger's stages and simulated block numbers. Switch to a blockchain network to see real transactions and blocks.
        </Callout>
      )}

      <Card className="mb-6">
        <CardHeader
          title="Transaction lifecycle"
          subtitle="Device → Gateway → RPC → Pending → Block inclusion → Confirmation → Contract event"
          icon={<Radio className="size-4" />}
          actions={
            candidates.length > 0 && (
              <Select aria-label="Select an operation" className="h-8 w-72 text-xs" value={tx?.id ?? ""} onChange={(e) => setSelectedId(e.target.value)}>
                {candidates.slice(0, 40).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </Select>
            )
          }
        />
        <CardBody>
          {tx ? (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
                <StageBadge stage={tx.stage} local={tx.local} />
                <span className="text-ink-muted">{tx.label}</span>
                {tx.txHash && tx.chainId && explorerTxUrl(tx.chainId, tx.txHash) && (
                  <HashText value={tx.txHash} href={explorerTxUrl(tx.chainId, tx.txHash)} />
                )}
                {tx.local && <Badge tone="local">simulated lifecycle</Badge>}
              </div>
              <Pipeline nodes={buildPipeline(tx, ledger.blockNumber, blockTime)} />
              {tx.error && <p className="mt-3 text-sm text-danger-600">{tx.error.message}</p>}
              {!tx.local && tx.stage === "confirmed" && (
                <p className="mt-3 text-xs text-ink-faint">
                  Confirmations = latest block − inclusion block + 1, updated live from the RPC node. More confirmations mean the block is less likely to be replaced.
                </p>
              )}
            </>
          ) : (
            <EmptyState icon={<Network className="size-5" />} title="No operations to trace yet">
              Submit a reading or register a device; its lifecycle will be traced here.
            </EmptyState>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Recent blocks"
            subtitle={isLocal ? "Not available in local demo mode" : `Live from ${network?.name ?? "the RPC node"} · refreshes every 6 s`}
            icon={<Blocks className="size-4" />}
            actions={!isLocal && ledger.blockNumber !== null && <Badge tone="info" dot pulse>head #{ledger.blockNumber.toLocaleString()}</Badge>}
          />
          {isLocal ? (
            <EmptyState title="No real blocks">Local demo mode does not produce or read blockchain blocks.</EmptyState>
          ) : blockError ? (
            <CardBody>
              <Callout tone="danger">{blockError}</Callout>
            </CardBody>
          ) : blocks.length === 0 ? (
            <EmptyState title="Loading blocks…" />
          ) : (
            <div className="scrollbar-thin overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-ink-muted">
                    <th className="px-5 py-2.5 font-medium">Block</th>
                    <th className="px-3 py-2.5 font-medium">Age</th>
                    <th className="px-3 py-2.5 text-right font-medium">Txs</th>
                    <th className="px-5 py-2.5 font-medium">Gas used</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {blocks.map((b) => {
                    const url = explorerBlockUrl(settings.chainId, b.number);
                    const pct = b.gasLimit > 0n ? Number((b.gasUsed * 1000n) / b.gasLimit) / 10 : 0;
                    return (
                      <tr key={b.number} className={cn(ourBlocks.has(b.number) && "bg-forest-50")}>
                        <td className="tabular px-5 py-2.5 font-mono text-xs">
                          {url ? (
                            <a href={url} target="_blank" rel="noreferrer noopener" className="text-chain-600 hover:underline">
                              {b.number.toLocaleString()}
                            </a>
                          ) : (
                            b.number.toLocaleString()
                          )}
                          {ourBlocks.has(b.number) && <Badge tone="success" className="ml-2 font-sans">contains your tx</Badge>}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-ink-muted">{relativeTime(b.timestamp * 1000)}</td>
                        <td className="tabular px-3 py-2.5 text-right">{b.txCount}</td>
                        <td className="px-5 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-line" aria-hidden="true">
                              <div className="h-full rounded-full bg-chain-500" style={{ width: `${Math.min(100, pct)}%` }} />
                            </div>
                            <span className="tabular text-xs text-ink-muted">{pct.toFixed(1)}%</span>
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

        <Card>
          <CardHeader title="Consensus layer" subtitle="How blocks are agreed on (illustration)" icon={<Network className="size-4" />} />
          <CardBody>
            <ConsensusIllustration />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
