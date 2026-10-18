import { ChevronDown, LogOut, Menu, RefreshCw, Wallet } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { chainLabel, getNetwork } from "@core/networks.js";
import { useLedger } from "../../state/LedgerContext";
import { useSettings } from "../../state/SettingsContext";
import { useToast } from "../../state/ToastContext";
import { useWallet } from "../../state/WalletContext";
import { APPROX_READING_COST_WEI, formatNative, shortHex } from "../../utils/format";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { CopyButton } from "../ui/HashText";

function ModeBadge() {
  const { settings, networkConfigured } = useSettings();
  const { blockNumber, status } = useLedger();
  if (settings.mode === "local") {
    return (
      <Badge tone="local" dot title="Readings are signed and verified in this browser. Nothing is sent to a blockchain.">
        Local demo · no blockchain
      </Badge>
    );
  }
  const network = getNetwork(settings.chainId);
  if (!networkConfigured) return <Badge tone="warning" dot>{network?.shortName ?? "Network"} · contract not set</Badge>;
  return (
    <Badge tone={status === "error" ? "danger" : "info"} dot pulse={status === "ready"} title={network?.name}>
      {network?.name ?? chainLabel(settings.chainId)}
      {blockNumber !== null && <span className="tabular font-mono text-[10px] opacity-80">#{blockNumber.toLocaleString()}</span>}
    </Badge>
  );
}

function WalletControl() {
  const wallet = useWallet();
  const { settings } = useSettings();
  const { walletBalance } = useLedger();
  const symbol = getNetwork(settings.chainId)?.nativeCurrency.symbol ?? "ETH";
  const showBalance = settings.mode === "network" && walletBalance !== null && wallet.chainId === settings.chainId;
  const lowBalance = showBalance && walletBalance! < APPROX_READING_COST_WEI * 3n;
  const { notify } = useToast();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (wallet.error) {
      notify({ tone: wallet.error.kind === "wallet-rejected" ? "warning" : "error", title: "Wallet", message: wallet.error.message });
      wallet.clearError();
    }
  }, [wallet, notify]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (wallet.status === "unavailable") {
    return (
      <a
        href="https://metamask.io/download/"
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 py-2 text-xs font-medium text-ink-muted hover:text-ink"
        title={settings.mode === "local" ? "Not needed in local demo mode" : "A wallet is required to send transactions"}
      >
        <Wallet className="size-4" /> No wallet detected · Get MetaMask
      </a>
    );
  }

  if (wallet.status !== "connected" || !wallet.account) {
    return (
      <Button size="sm" icon={<Wallet className="size-4" />} loading={wallet.busy} onClick={() => void wallet.connect()}>
        Connect wallet
      </Button>
    );
  }

  const wrongNetwork = settings.mode === "network" && wallet.chainId !== settings.chainId;
  return (
    <div className="flex items-center gap-2" ref={menuRef}>
      {lowBalance && (
        <Badge tone="warning" dot title={`Gas money is low: about ${formatNative(APPROX_READING_COST_WEI, symbol)} is needed per reading. Use a faucet.`}>
          Low {symbol}
        </Badge>
      )}
      {wrongNetwork && (
        <Button
          size="sm"
          variant="danger"
          icon={<RefreshCw className="size-3.5" />}
          loading={wallet.busy}
          onClick={() => void wallet.switchNetwork(settings.chainId)}
          title={`Wallet is on ${chainLabel(wallet.chainId ?? 0)}`}
        >
          Switch to {getNetwork(settings.chainId)?.shortName}
        </Button>
      )}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium hover:bg-surface-2"
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <span className={`size-2 rounded-full ${wrongNetwork ? "bg-danger-500" : "bg-forest-500"}`} />
          <span className="font-mono">{shortHex(wallet.account, 4)}</span>
          {showBalance && <span className="tabular hidden text-ink-muted md:inline">· {formatNative(walletBalance!, symbol)}</span>}
          <span className="hidden text-ink-faint sm:inline">· {chainLabel(wallet.chainId ?? 0)}</span>
          <ChevronDown className="size-3.5 text-ink-faint" />
        </button>
        {open && (
          <div role="menu" className="absolute right-0 z-30 mt-2 w-72 animate-fade-in rounded-xl border border-line bg-surface p-3 shadow-[var(--shadow-pop)]">
            <p className="text-[11px] font-medium tracking-wide text-ink-faint uppercase">Connected account</p>
            <div className="mt-1 flex items-center gap-1 font-mono text-xs break-all">
              {wallet.account}
              <CopyButton value={wallet.account} />
            </div>
            {showBalance && (
              <>
                <p className="mt-3 text-[11px] font-medium tracking-wide text-ink-faint uppercase">Balance (pays gas)</p>
                <p className="tabular mt-1 text-xs">
                  {formatNative(walletBalance!, symbol)}{" "}
                  <span className="text-ink-faint">≈ {(walletBalance! / APPROX_READING_COST_WEI).toString()} readings</span>
                </p>
              </>
            )}
            <p className="mt-3 text-[11px] font-medium tracking-wide text-ink-faint uppercase">Wallet network</p>
            <p className="mt-1 text-xs">
              {chainLabel(wallet.chainId ?? 0)} <span className="text-ink-faint">(chain ID {wallet.chainId})</span>
            </p>
            <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
              CropLedger never asks for your private key or seed phrase. Every transaction is approved in MetaMask.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-3 w-full"
              icon={<LogOut className="size-3.5" />}
              onClick={() => {
                setOpen(false);
                void wallet.disconnect();
              }}
            >
              Disconnect
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export function TopBar({ onMenu }: { onMenu: () => void }) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-paper/90 px-4 backdrop-blur sm:px-6">
      <button type="button" className="rounded p-1.5 hover:bg-black/5 lg:hidden" onClick={onMenu} aria-label="Open menu">
        <Menu className="size-5" />
      </button>
      <ModeBadge />
      <div className="ml-auto">
        <WalletControl />
      </div>
    </header>
  );
}
