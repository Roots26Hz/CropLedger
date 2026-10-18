import { ArrowLeftRight, Ban, Cpu, Search, ShieldAlert, Trash2, UploadCloud } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { decodeError } from "@core/errors.js";
import { explorerBlockUrl, explorerTxUrl } from "@core/networks.js";
import type { Hex } from "@core/types.js";
import { PageHeader } from "../components/layout/PageHeader";
import { FAILURE_STAGES, PENDING_STAGES, StageBadge } from "../components/StageBadge";
import { Button } from "../components/ui/Button";
import { Callout } from "../components/ui/Callout";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { HashText } from "../components/ui/HashText";
import { Tabs } from "../components/ui/Tabs";
import { useLedgerReadings } from "../hooks/useLedgerReadings";
import { useLedger } from "../state/LedgerContext";
import { useSettings } from "../state/SettingsContext";
import { useToast } from "../state/ToastContext";
import type { TxKind, TxRecord } from "../types/app";
import { formatDateTime, relativeTime } from "../utils/format";

type Filter = "all" | "confirmed" | "pending" | "failed";

const kindIcon: Record<TxKind, ReactNode> = {
  submitReading: <UploadCloud className="size-3.5" />,
  registerDevice: <Cpu className="size-3.5" />,
  revokeDevice: <Ban className="size-3.5" />,
  attack: <ShieldAlert className="size-3.5" />,
};

interface ChainTx {
  key: string;
  deviceLabel: string;
  index: number;
  nonce: string;
  blockNumber: bigint;
  txHash: Hex;
  gasUsed: bigint;
  from: string;
}

function TxRow({ t }: { t: TxRecord }) {
  const url = t.txHash && t.chainId ? explorerTxUrl(t.chainId, t.txHash) : undefined;
  const blockUrl = t.blockNumber !== undefined && t.chainId ? explorerBlockUrl(t.chainId, t.blockNumber) : undefined;
  return (
    <tr className="align-top">
      <td className="px-5 py-3">
        <p className="flex items-center gap-1.5 font-medium">
          <span className="text-ink-faint">{kindIcon[t.kind]}</span>
          {t.label}
        </p>
        {t.error && <p className="mt-1 max-w-md text-xs leading-snug text-danger-600">{t.error.message}</p>}
      </td>
      <td className="px-3 py-3">
        <StageBadge stage={t.stage} local={t.local} />
      </td>
      <td className="px-3 py-3">
        {t.txHash ? (
          <HashText value={t.txHash} chars={6} href={url} />
        ) : t.localRef ? (
          <span className="font-mono text-xs text-soil-700" title="Local demo reference — not a blockchain transaction">
            {t.localRef}
          </span>
        ) : (
          <span className="text-xs text-ink-faint">{FAILURE_STAGES.includes(t.stage) ? "not broadcast" : "—"}</span>
        )}
      </td>
      <td className="tabular px-3 py-3 font-mono text-xs">
        {t.blockNumber === undefined ? (
          "—"
        ) : blockUrl ? (
          <a className="text-chain-600 hover:underline" href={blockUrl} target="_blank" rel="noreferrer noopener">
            {t.blockNumber}
          </a>
        ) : (
          <span title={t.local ? "Simulated block (local demo)" : undefined}>
            {t.blockNumber}
            {t.local && <span className="text-ink-faint"> (sim)</span>}
          </span>
        )}
      </td>
      <td className="px-3 py-3 text-xs whitespace-nowrap">{t.deviceLabel ?? "—"}</td>
      <td className="tabular px-3 py-3 text-right font-mono text-xs">{t.gasUsed ? Number(t.gasUsed).toLocaleString() : "—"}</td>
      <td className="px-5 py-3 text-xs whitespace-nowrap text-ink-muted" title={new Date(t.createdAt).toLocaleString()}>
        {relativeTime(t.updatedAt)}
      </td>
    </tr>
  );
}

export function TransactionsPage() {
  const { settings } = useSettings();
  const ledger = useLedger();
  const { notify } = useToast();
  const [filter, setFilter] = useState<Filter>("all");
  const { readings } = useLedgerReadings();
  const [chainTxs, setChainTxs] = useState<ChainTx[] | null>(null);
  const [looking, setLooking] = useState(false);
  const isLocal = settings.mode === "local";

  const filtered = useMemo(
    () =>
      ledger.txs.filter((t) =>
        filter === "all" ? true : filter === "confirmed" ? t.stage === "confirmed" : filter === "pending" ? PENDING_STAGES.includes(t.stage) : FAILURE_STAGES.includes(t.stage),
      ),
    [ledger.txs, filter],
  );

  const counts = {
    all: ledger.txs.length,
    confirmed: ledger.txs.filter((t) => t.stage === "confirmed").length,
    pending: ledger.txs.filter((t) => PENDING_STAGES.includes(t.stage)).length,
    failed: ledger.txs.filter((t) => FAILURE_STAGES.includes(t.stage)).length,
  };

  /** Find the transactions behind the most recent on-chain readings (any gateway). */
  const lookUp = async () => {
    const svc = ledger.service;
    if (!svc?.findReadingTransaction) return;
    setLooking(true);
    try {
      const recent = [...readings].reverse().slice(0, 25);
      const found = await Promise.all(
        recent.map(async (r) => {
          const tx = await svc.findReadingTransaction!(r.deviceId, r.index, r.blockNumber);
          return tx
            ? { key: `${r.deviceId}-${r.index}`, deviceLabel: r.deviceLabel, index: r.index, nonce: r.nonce.toString(), blockNumber: r.blockNumber, ...tx }
            : null;
        }),
      );
      setChainTxs(found.filter((x): x is ChainTx => x !== null));
    } catch (e) {
      notify({ tone: "error", title: "Lookup failed", message: decodeError(e).message });
    } finally {
      setLooking(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Blockchain Transactions"
        description="Every registration, reading submission and attack attempt started from this browser, with its lifecycle status. A transaction is only shown as confirmed once its receipt is available."
        actions={
          ledger.txs.length > 0 && (
            <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={ledger.clearTxs} title="Clears the browser log only">
              Clear log
            </Button>
          )
        }
      />

      {isLocal && (
        <Callout tone="warning" className="mb-6">
          Local demo operations carry a local reference (LOCAL-…) instead of a transaction hash and have no explorer links, because nothing was sent to a
          blockchain.
        </Callout>
      )}

      <Card className="mb-6">
        <CardHeader
          title="Operations from this browser"
          icon={<ArrowLeftRight className="size-4" />}
          actions={
            <Tabs<Filter>
              items={[
                { key: "all", label: `All ${counts.all}` },
                { key: "confirmed", label: `Confirmed ${counts.confirmed}` },
                { key: "pending", label: `Pending ${counts.pending}` },
                { key: "failed", label: `Failed ${counts.failed}` },
              ]}
              active={filter}
              onChange={setFilter}
            />
          }
        />
        {filtered.length === 0 ? (
          <EmptyState icon={<ArrowLeftRight className="size-5" />} title={ledger.txs.length === 0 ? "No operations yet" : "Nothing matches this filter"}>
            Register a device or submit readings to see them here.
          </EmptyState>
        ) : (
          <div className="scrollbar-thin overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-muted">
                  <th className="px-5 py-2.5 font-medium">Operation</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">{isLocal ? "Reference" : "Transaction hash"}</th>
                  <th className="px-3 py-2.5 font-medium">Block</th>
                  <th className="px-3 py-2.5 font-medium">Device</th>
                  <th className="px-3 py-2.5 text-right font-medium whitespace-nowrap">Gas used</th>
                  <th className="px-5 py-2.5 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map((t) => (
                  <TxRow key={t.id} t={t} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {!isLocal && ledger.service && (
        <Card>
          <CardHeader
            title="On-chain reading transactions"
            subtitle="Looks up the transaction behind each recent reading via its ReadingRecorded event — including readings relayed by other gateways such as the Node CLI."
            icon={<Search className="size-4" />}
            actions={
              <Button size="sm" variant="secondary" loading={looking} onClick={() => void lookUp()} disabled={readings.length === 0} disabledReason="No readings on-chain yet">
                Look up last {Math.min(25, readings.length)}
              </Button>
            }
          />
          {chainTxs === null ? (
            <CardBody>
              <p className="text-sm text-ink-muted">Each stored reading records its block number, so the lookup queries a single block per reading (cheap and reliable on public RPCs).</p>
            </CardBody>
          ) : chainTxs.length === 0 ? (
            <EmptyState title="No matching events found" />
          ) : (
            <div className="scrollbar-thin overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-ink-muted">
                    <th className="px-5 py-2.5 font-medium">Reading</th>
                    <th className="px-3 py-2.5 font-medium">Transaction hash</th>
                    <th className="px-3 py-2.5 font-medium">Block</th>
                    <th className="px-3 py-2.5 font-medium">Relayed by (gateway)</th>
                    <th className="px-5 py-2.5 text-right font-medium">Gas used</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {chainTxs.map((c) => (
                    <tr key={c.key}>
                      <td className="px-5 py-2.5">
                        {c.deviceLabel} <span className="text-ink-faint">#{c.index} · nonce {c.nonce}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <HashText value={c.txHash} href={explorerTxUrl(settings.chainId, c.txHash)} />
                      </td>
                      <td className="tabular px-3 py-2.5 font-mono text-xs">{c.blockNumber.toString()}</td>
                      <td className="px-3 py-2.5">
                        <HashText value={c.from} chars={4} />
                      </td>
                      <td className="tabular px-5 py-2.5 text-right font-mono text-xs">{c.gasUsed.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {!isLocal && (
        <p className="mt-4 text-xs text-ink-faint">
          Explorer links point to {settings.chainId === 80002 ? "amoy.polygonscan.com (the Amoy testnet explorer)" : "nothing: a local Hardhat chain has no public explorer"}.
          Times shown are from this browser; block times are on the explorer. Last refresh: {ledger.lastUpdated ? formatDateTime(ledger.lastUpdated / 1000) : "—"}.
        </p>
      )}
    </>
  );
}
