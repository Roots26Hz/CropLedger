/**
 * MetaMask (EIP-1193) integration. The app only ever asks the wallet for
 * accounts, the chain ID, network switching and transaction signatures. It
 * never requests, stores or displays private keys or seed phrases.
 */
import { BrowserProvider, type JsonRpcSigner } from "ethers";
import { addChainParameters, type NetworkConfig } from "@core/networks.js";

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
  isMetaMask?: boolean;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider & { providers?: Eip1193Provider[] };
  }
}

/** Return the injected wallet, preferring MetaMask when several are present. */
export function getInjectedProvider(): Eip1193Provider | null {
  const injected = window.ethereum;
  if (!injected) return null;
  const metaMask = injected.providers?.find((p) => p.isMetaMask);
  return metaMask ?? injected;
}

export async function requestAccounts(provider: Eip1193Provider): Promise<string[]> {
  return (await provider.request({ method: "eth_requestAccounts" })) as string[];
}

/** Accounts the site is already authorised for (no popup). */
export async function getAuthorizedAccounts(provider: Eip1193Provider): Promise<string[]> {
  return (await provider.request({ method: "eth_accounts" })) as string[];
}

export async function getWalletChainId(provider: Eip1193Provider): Promise<number> {
  const hex = (await provider.request({ method: "eth_chainId" })) as string;
  return Number.parseInt(hex, 16);
}

function errorCode(error: unknown): number | undefined {
  const e = error as { code?: number; data?: { originalError?: { code?: number } } };
  return e?.code ?? e?.data?.originalError?.code;
}

/**
 * Ask the wallet to switch to the given network, adding it first if the
 * wallet does not know it (error 4902).
 */
export async function switchWalletNetwork(provider: Eip1193Provider, network: NetworkConfig): Promise<void> {
  const chainId = `0x${network.chainId.toString(16)}`;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (error) {
    const code = errorCode(error);
    const unknownChain = code === 4902 || /unrecognized chain|unknown chain/i.test(String((error as Error)?.message));
    if (!unknownChain) throw error;
    // Always register the network's public RPC in the wallet, never a keyed URL.
    await provider.request({ method: "wallet_addEthereumChain", params: [addChainParameters(network)] });
  }
}

/** Best-effort disconnect: MetaMask supports revoking the site's permission. */
export async function revokeWalletPermissions(provider: Eip1193Provider): Promise<void> {
  try {
    await provider.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
  } catch {
    // Older wallets do not support this; the app still forgets the account.
  }
}

export async function getBrowserSigner(provider: Eip1193Provider): Promise<JsonRpcSigner> {
  return new BrowserProvider(provider).getSigner();
}
