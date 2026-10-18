import {
  CheckCircle2,
  CircleSlash,
  Database,
  Download,
  ExternalLink,
  FlaskConical,
  Globe,
  KeyRound,
  Laptop,
  RotateCcw,
  Save,
  Stethoscope,
  Trash2,
  Upload,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { isAddress } from "ethers";
import { HARDHAT_LOCAL, POLYGON_AMOY, explorerAddressUrl, getNetwork } from "@core/networks.js";
import type { SignedReadingJson } from "@core/serialization.js";
import { PageHeader } from "../components/layout/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Callout } from "../components/ui/Callout";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Field, Input, Select } from "../components/ui/Field";
import { HashText } from "../components/ui/HashText";
import { ConfirmDialog } from "../components/ui/Modal";
import { ENV, maskRpcUrl } from "../config/env";
import { runDiagnostics, type Check } from "../services/diagnostics";
import { LocalLedgerService } from "../services/ledger/localLedgerService";
import { removeByPrefix } from "../services/storage";
import { useLedger } from "../state/LedgerContext";
import { useSettings } from "../state/SettingsContext";
import { useToast } from "../state/ToastContext";
import { useWallet } from "../state/WalletContext";
import type { AppMode } from "../types/app";
import { cn } from "../utils/cn";
import { downloadJson, readFileText } from "../utils/download";

function ModeOption({
  mode,
  active,
  icon,
  title,
  points,
  onSelect,
}: {
  mode: AppMode;
  active: boolean;
  icon: ReactNode;
  title: string;
  points: string[];
  onSelect: (mode: AppMode) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(mode)}
      aria-pressed={active}
      className={cn(
        "flex flex-1 flex-col gap-2 rounded-xl border p-4 text-left transition-colors",
        active ? "border-forest-500 bg-forest-50 ring-2 ring-forest-100" : "border-line bg-surface hover:border-line-strong",
      )}
    >
      <div className="flex items-center gap-2">
        <span className={active ? "text-forest-600" : "text-ink-faint"}>{icon}</span>
        <span className="text-sm font-semibold">{title}</span>
        {active && <Badge tone="success" className="ml-auto">Active</Badge>}
      </div>
      <ul className="space-y-1 text-[13px] text-ink-muted">
        {points.map((p) => (
          <li key={p} className="flex gap-2">
            <span className="mt-2 size-1 shrink-0 rounded-full bg-ink-faint" />
            {p}
          </li>
        ))}
      </ul>
    </button>
  );
}

const statusIcon: Record<Check["status"], ReactNode> = {
  pass: <CheckCircle2 className="size-4 text-forest-600" />,
  warn: <AlertTriangle className="size-4 text-soil-600" />,
  fail: <XCircle className="size-4 text-danger-600" />,
  skip: <CircleSlash className="size-4 text-ink-faint" />,
};

export function SystemConfigPage() {
  const { settings, setMode, saveNetworkSettings, resetToEnv, networkConfigured } = useSettings();
  const wallet = useWallet();
  const ledger = useLedger();
  const { notify } = useToast();

  const [chainId, setChainId] = useState(settings.chainId);
  const [address, setAddress] = useState(settings.contractAddress);
  const [rpcUrl, setRpcUrl] = useState(settings.rpcUrl);
  const [deployBlock, setDeployBlock] = useState(settings.deployBlock?.toString() ?? "");
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirm, setConfirm] = useState<null | "reset-local" | "forget-keys" | "clear-history">(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setChainId(settings.chainId);
    setAddress(settings.contractAddress);
    setRpcUrl(settings.rpcUrl);
    setDeployBlock(settings.deployBlock?.toString() ?? "");
  }, [settings]);

  const addressError = address && !isAddress(address) ? "Not a valid 0x address." : undefined;
  const rpcError = rpcUrl && !/^https?:\/\//.test(rpcUrl) ? "Must start with http:// or https://" : undefined;
  const blockError = deployBlock && !/^\d+$/.test(deployBlock) ? "Must be a whole number." : undefined;
  const dirty =
    chainId !== settings.chainId || address !== settings.contractAddress || rpcUrl !== settings.rpcUrl || deployBlock !== (settings.deployBlock?.toString() ?? "");

  const save = () => {
    if (addressError || rpcError || blockError) return;
    saveNetworkSettings({ chainId, contractAddress: address.trim(), rpcUrl: rpcUrl.trim(), deployBlock: deployBlock ? Number(deployBlock) : null });
    setChecks(null);
    notify({ tone: "success", title: "Network settings saved", message: "Stored in this browser. They override the .env defaults." });
  };

  const onNetworkChange = (next: number) => {
    setChainId(next);
    const net = getNetwork(next)!;
    // Suggest the matching default RPC when switching networks.
    if (rpcUrl === getNetwork(chainId)?.defaultRpcUrl || !rpcUrl) setRpcUrl(net.defaultRpcUrl);
  };

  const diagnose = async () => {
    setChecking(true);
    try {
      setChecks(
        await runDiagnostics({
          chainId: settings.chainId,
          contractAddress: settings.contractAddress,
          rpcUrl: settings.rpcUrl,
          wallet: { status: wallet.status, account: wallet.account, chainId: wallet.chainId },
        }),
      );
    } finally {
      setChecking(false);
    }
  };

  const exportEvidence = () => {
    const items = ledger.evidence.all();
    downloadJson(`cropledger-evidence-${settings.mode === "local" ? "local-demo" : settings.chainId}.json`, items);
  };

  const importEvidence = async (file: File) => {
    try {
      const parsed = JSON.parse(await readFileText(file)) as unknown;
      const list = (Array.isArray(parsed) ? parsed : [parsed]) as SignedReadingJson[];
      const count = ledger.evidence.importMany(list);
      notify({ tone: count ? "success" : "warning", title: `Imported ${count} payload record(s)`, message: count ? undefined : "No CropLedger signed readings found in that file." });
    } catch (e) {
      notify({ tone: "error", title: "Import failed", message: (e as Error).message });
    }
  };

  const doConfirm = () => {
    if (confirm === "reset-local") {
      LocalLedgerService.reset();
      removeByPrefix("feed.v1.local");
      removeByPrefix("txlog.v1.local");
      removeByPrefix("evidence.v1.local");
      notify({ tone: "success", title: "Local demo data reset", message: "Reloading…" });
      setTimeout(() => window.location.reload(), 600);
    } else if (confirm === "forget-keys") {
      ledger.forgetDeviceKeys();
      notify({ tone: "success", title: "Simulated device keys removed from this browser" });
    } else if (confirm === "clear-history") {
      ledger.clearTxs();
      notify({ tone: "success", title: "Transaction history cleared (browser log only)" });
    }
    setConfirm(null);
  };

  const env = [
    { name: "VITE_CHAIN_ID", value: ENV.chainId?.toString() },
    { name: "VITE_CONTRACT_ADDRESS", value: ENV.contractAddress ?? undefined },
    { name: "VITE_RPC_URL", value: ENV.rpcUrl ? maskRpcUrl(ENV.rpcUrl) : undefined },
    { name: "VITE_DEPLOY_BLOCK", value: ENV.deployBlock?.toString() },
  ];

  const explorer = networkConfigured ? explorerAddressUrl(settings.chainId, settings.contractAddress) : undefined;

  return (
    <>
      <PageHeader
        title="System Configuration"
        description="Choose between the local demonstration and a real blockchain deployment, point the dashboard at your contract, and check that everything is wired correctly. No secrets are shown or stored here."
      />

      <Card className="mb-6">
        <CardHeader title="Operating mode" subtitle="Switching mode never happens automatically, even after an error." />
        <CardBody className="flex flex-col gap-3 md:flex-row">
          <ModeOption
            mode="local"
            active={settings.mode === "local"}
            icon={<Laptop className="size-5" />}
            title="Local demonstration"
            onSelect={setMode}
            points={[
              "No wallet, tokens or deployment needed",
              "Real hashing, EIP-712 signatures, replay and revocation rules (same as the contract)",
              "No transactions: no hashes, gas or explorer links; blocks are simulated",
            ]}
          />
          <ModeOption
            mode="network"
            active={settings.mode === "network"}
            icon={<Globe className="size-5" />}
            title="Blockchain network"
            onSelect={setMode}
            points={[
              "Uses your deployed CropLedger on Polygon Amoy or a local Hardhat node",
              "MetaMask signs every transaction; you approve each one",
              "Real transaction hashes, blocks, gas and (Amoy) PolygonScan links",
            ]}
          />
        </CardBody>
      </Card>

      <div className="grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader
            title="Network configuration"
            subtitle={settings.source === "user" ? "Saved in this browser (overrides .env)" : "Loaded from .env (VITE_* variables)"}
            actions={settings.source === "user" && <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={resetToEnv}>Reset to .env</Button>}
          />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Network" htmlFor="cfg-network" hint="Only testnet/local chains are allowed.">
              <Select id="cfg-network" value={chainId} onChange={(e) => onNetworkChange(Number(e.target.value))}>
                <option value={POLYGON_AMOY.chainId}>Polygon Amoy Testnet (80002)</option>
                <option value={HARDHAT_LOCAL.chainId}>Hardhat Local Node (31337)</option>
              </Select>
            </Field>
            <Field label="Deployment block (optional)" htmlFor="cfg-block" error={blockError} hint="From the deployment transaction.">
              <Input id="cfg-block" inputMode="numeric" value={deployBlock} onChange={(e) => setDeployBlock(e.target.value.trim())} placeholder="e.g. 18234567" />
            </Field>
            <Field className="sm:col-span-2" label="CropLedger contract address" htmlFor="cfg-address" error={addressError} hint="Copy it from Remix → Deploy & Run → Deployed Contracts.">
              <Input id="cfg-address" className="font-mono text-[13px]" value={address} onChange={(e) => setAddress(e.target.value.trim())} placeholder="0x…" spellCheck={false} />
            </Field>
            <Field className="sm:col-span-2" label="Read RPC URL" htmlFor="cfg-rpc" error={rpcError} hint="Used for read-only queries. It is visible in the browser, so use a public endpoint or a domain-restricted key.">
              <Input id="cfg-rpc" className="font-mono text-[13px]" value={rpcUrl} onChange={(e) => setRpcUrl(e.target.value.trim())} spellCheck={false} />
            </Field>
            <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
              <Button icon={<Save className="size-4" />} onClick={save} disabled={!dirty || Boolean(addressError || rpcError || blockError)} disabledReason={!dirty ? "No changes to save" : "Fix the highlighted fields"}>
                Save settings
              </Button>
              {explorer && (
                <a href={explorer} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-sm text-chain-600 hover:underline">
                  View contract on PolygonScan (Amoy) <ExternalLink className="size-3.5" />
                </a>
              )}
            </div>
          </CardBody>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader
            title="Diagnostics"
            subtitle="Read-only checks of the saved configuration"
            icon={<Stethoscope className="size-4" />}
            actions={
              <Button size="sm" variant="secondary" loading={checking} onClick={() => void diagnose()} disabled={!networkConfigured} disabledReason="Save a contract address first">
                Run checks
              </Button>
            }
          />
          <CardBody>
            {!networkConfigured ? (
              <p className="text-sm text-ink-muted">Save a contract address to check the RPC endpoint, contract, ABI compatibility and wallet.</p>
            ) : !checks ? (
              <p className="text-sm text-ink-muted">Run the checks to verify the RPC endpoint, the deployed contract, the EIP-712 signing format and your wallet.</p>
            ) : (
              <ul className="space-y-3">
                {checks.map((c) => (
                  <li key={c.id} className="flex gap-3">
                    <span className="mt-0.5">{statusIcon[c.status]}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{c.label}</p>
                      <p className="text-[13px] break-words text-ink-muted">{c.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Environment (.env)" subtitle="Public VITE_* values compiled into this build" icon={<KeyRound className="size-4" />} />
          <CardBody>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-line">
                {env.map((row) => (
                  <tr key={row.name}>
                    <td className="py-2 pr-4 font-mono text-[12px] text-ink-muted">{row.name}</td>
                    <td className="py-2">{row.value ? <span className="font-mono text-[12px] break-all">{row.value}</span> : <Badge>not set</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {ENV.issues.length > 0 && (
              <Callout tone="warning" title="Configuration problems" className="mt-4">
                <ul className="list-disc pl-4">
                  {ENV.issues.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              </Callout>
            )}
            <p className="mt-4 text-[13px] text-ink-muted">
              Server-side secrets (<code className="font-mono text-[12px]">DEPLOYER_PRIVATE_KEY</code>, <code className="font-mono text-[12px]">GATEWAY_PRIVATE_KEY</code>) are only read by Hardhat scripts and the Node CLI and are never bundled into the dashboard. The RPC URL is shown without its path in case it contains an API key.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Browser data" subtitle="Demonstration data kept in this browser only" icon={<Database className="size-4" />} />
          <CardBody className="space-y-4">
            <dl className="grid grid-cols-3 gap-3 text-center">
              {[
                ["Simulated device keys", ledger.deviceKeys.length],
                ["Off-chain payloads", ledger.evidence.all().length],
                ["Logged operations", ledger.txs.length],
              ].map(([label, value]) => (
                <div key={label as string} className="rounded-lg bg-surface-2 p-3">
                  <dd className="tabular text-xl font-semibold">{value}</dd>
                  <dt className="text-[11px] text-ink-muted">{label}</dt>
                </div>
              ))}
            </dl>
            <p className="text-[13px] text-ink-muted">
              The off-chain payload store plays the role of the vendor database: it holds full readings, while the ledger
              holds their hashes. Simulated device keys are test keys for demonstration (a real device keeps its key in
              secure hardware); they are never displayed.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" icon={<Download className="size-3.5" />} onClick={exportEvidence} disabled={ledger.evidence.all().length === 0} disabledReason="No payloads stored yet">
                Export payloads
              </Button>
              <Button size="sm" variant="outline" icon={<Upload className="size-3.5" />} onClick={() => fileRef.current?.click()}>
                Import payloads
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void importEvidence(file);
                  e.target.value = "";
                }}
              />
              <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => setConfirm("clear-history")}>
                Clear operation log
              </Button>
              <Button size="sm" variant="ghost" icon={<KeyRound className="size-3.5" />} onClick={() => setConfirm("forget-keys")} disabled={ledger.deviceKeys.length === 0}>
                Forget device keys
              </Button>
              <Button size="sm" variant="ghost" icon={<FlaskConical className="size-3.5" />} onClick={() => setConfirm("reset-local")}>
                Reset local demo
              </Button>
            </div>
            {settings.mode === "network" && settings.chainId === POLYGON_AMOY.chainId && (
              <Callout tone="info" title="Need Amoy test POL?">
                Gas on Amoy is paid in test POL with no real value. Request some from the{" "}
                <a className="text-chain-600 underline" href={POLYGON_AMOY.faucets[0]} target="_blank" rel="noreferrer noopener">
                  Polygon faucet
                </a>{" "}
                (subject to availability and eligibility).
              </Callout>
            )}
          </CardBody>
        </Card>
      </div>

      {networkConfigured && settings.mode === "network" && (
        <p className="mt-6 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          Active contract: <HashText value={settings.contractAddress} short={false} href={explorer} />
        </p>
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm === "reset-local" ? "Reset local demo data?" : confirm === "forget-keys" ? "Forget simulated device keys?" : "Clear operation log?"}
        confirmLabel={confirm === "forget-keys" ? "Forget keys" : confirm === "reset-local" ? "Reset" : "Clear"}
        danger
        onCancel={() => setConfirm(null)}
        onConfirm={doConfirm}
      >
        {confirm === "reset-local" && <p>This erases the in-browser demo ledger, its feed, log and payloads. Blockchain data is not affected.</p>}
        {confirm === "forget-keys" && <p>Devices registered with these keys will no longer be able to sign new readings from this browser. Their recorded history is not affected.</p>}
        {confirm === "clear-history" && <p>This clears the list of operations started from this browser. Blockchain data is not affected.</p>}
      </ConfirmDialog>
    </>
  );
}
