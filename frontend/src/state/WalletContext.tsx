import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getAddress } from "ethers";
import { decodeError, type DecodedError } from "@core/errors.js";
import { getNetwork } from "@core/networks.js";
import type { SignerSource } from "../services/ledger/evmLedgerService";
import { loadJson, saveJson } from "../services/storage";
import {
  getAuthorizedAccounts,
  getBrowserSigner,
  getInjectedProvider,
  getWalletChainId,
  requestAccounts,
  revokeWalletPermissions,
  switchWalletNetwork,
  type Eip1193Provider,
} from "../services/wallet";

export type WalletStatus = "unavailable" | "disconnected" | "connecting" | "connected";

interface WalletContextValue {
  status: WalletStatus;
  account: string | null;
  chainId: number | null;
  error: DecodedError | null;
  busy: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  switchNetwork: (chainId: number) => Promise<boolean>;
  clearError: () => void;
  signerSource: SignerSource;
}

const WalletContext = createContext<WalletContextValue | null>(null);
const DISCONNECTED_KEY = "wallet.userDisconnected.v1";

export function WalletProvider({ children }: { children: ReactNode }) {
  const providerRef = useRef<Eip1193Provider | null>(getInjectedProvider());
  const [status, setStatus] = useState<WalletStatus>(providerRef.current ? "disconnected" : "unavailable");
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [error, setError] = useState<DecodedError | null>(null);
  const [busy, setBusy] = useState(false);

  // Late-injected wallets (some extensions inject after page load).
  useEffect(() => {
    if (providerRef.current) return;
    const timer = setTimeout(() => {
      providerRef.current = getInjectedProvider();
      if (providerRef.current) setStatus("disconnected");
    }, 600);
    return () => clearTimeout(timer);
  }, []);

  const available = status !== "unavailable";

  // Silent restore of an existing authorisation (no popup), and listeners.
  useEffect(() => {
    const provider = providerRef.current;
    if (!provider || !available) return;

    const onAccounts = (...args: unknown[]) => {
      const accounts = (args[0] as string[] | undefined) ?? [];
      if (accounts.length === 0) {
        setAccount(null);
        setStatus("disconnected");
      } else {
        setAccount(getAddress(accounts[0]!));
        setStatus("connected");
      }
    };
    const onChain = (...args: unknown[]) => {
      const hex = args[0] as string;
      setChainId(Number.parseInt(hex, 16));
    };
    provider.on?.("accountsChanged", onAccounts);
    provider.on?.("chainChanged", onChain);

    if (!loadJson<boolean>(DISCONNECTED_KEY, false)) {
      void (async () => {
        try {
          const accounts = await getAuthorizedAccounts(provider);
          if (accounts.length > 0) {
            setAccount(getAddress(accounts[0]!));
            setChainId(await getWalletChainId(provider));
            setStatus("connected");
          }
        } catch {
          // Ignore: user can connect explicitly.
        }
      })();
    }
    return () => {
      provider.removeListener?.("accountsChanged", onAccounts);
      provider.removeListener?.("chainChanged", onChain);
    };
  }, [available]);

  const connect = useCallback(async () => {
    const provider = providerRef.current;
    if (!provider) {
      setError({ kind: "wallet-missing", message: "No browser wallet found. Install MetaMask, then reload this page." });
      return;
    }
    setBusy(true);
    setStatus("connecting");
    setError(null);
    try {
      const accounts = await requestAccounts(provider);
      if (accounts.length === 0) throw new Error("The wallet returned no accounts.");
      setAccount(getAddress(accounts[0]!));
      setChainId(await getWalletChainId(provider));
      setStatus("connected");
      saveJson(DISCONNECTED_KEY, false);
    } catch (e) {
      setError(decodeError(e));
      setStatus("disconnected");
    } finally {
      setBusy(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    const provider = providerRef.current;
    saveJson(DISCONNECTED_KEY, true);
    setAccount(null);
    setChainId(null);
    setStatus(provider ? "disconnected" : "unavailable");
    if (provider) await revokeWalletPermissions(provider);
  }, []);

  const switchNetwork = useCallback(async (target: number) => {
    const provider = providerRef.current;
    const network = getNetwork(target);
    if (!provider || !network) return false;
    setBusy(true);
    setError(null);
    try {
      await switchWalletNetwork(provider, network);
      setChainId(await getWalletChainId(provider));
      return true;
    } catch (e) {
      setError(decodeError(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const signerSource = useCallback<SignerSource>(async () => {
    const provider = providerRef.current;
    if (!provider) return { error: { kind: "wallet-missing", message: "No browser wallet found. Install MetaMask to send transactions." } };
    try {
      const accounts = await getAuthorizedAccounts(provider);
      if (accounts.length === 0) return { error: { kind: "wallet-rejected", message: "Connect your wallet first (top-right button)." } };
      const current = await getWalletChainId(provider);
      return { signer: await getBrowserSigner(provider), chainId: current };
    } catch (e) {
      return { error: decodeError(e) };
    }
  }, []);

  const value = useMemo<WalletContextValue>(
    () => ({ status, account, chainId, error, busy, connect, disconnect, switchNetwork, clearError: () => setError(null), signerSource }),
    [status, account, chainId, error, busy, connect, disconnect, switchNetwork, signerSource],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}
