/**
 * Build-time configuration from VITE_* environment variables (root .env).
 * These values are PUBLIC: they are compiled into the browser bundle.
 */
import { isAddress, getAddress } from "ethers";
import { getNetwork, chainLabel } from "@core/networks.js";

export interface EnvConfig {
  chainId: number | null;
  contractAddress: string | null;
  rpcUrl: string | null;
  deployBlock: number | null;
  /** Human-readable problems with the configuration (never contains secrets). */
  issues: string[];
}

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function readEnvConfig(env: ImportMetaEnv = import.meta.env): EnvConfig {
  const issues: string[] = [];

  let chainId: number | null = null;
  const rawChain = clean(env.VITE_CHAIN_ID);
  if (rawChain) {
    const parsed = Number(rawChain);
    if (!Number.isInteger(parsed) || parsed <= 0) issues.push(`VITE_CHAIN_ID "${rawChain}" is not a valid chain ID.`);
    else if (!getNetwork(parsed)) issues.push(`VITE_CHAIN_ID ${parsed} (${chainLabel(parsed)}) is not supported; use 80002 (Amoy) or 31337 (Hardhat).`);
    else chainId = parsed;
  }

  let contractAddress: string | null = null;
  const rawAddress = clean(env.VITE_CONTRACT_ADDRESS);
  if (rawAddress) {
    if (isAddress(rawAddress)) contractAddress = getAddress(rawAddress);
    else issues.push("VITE_CONTRACT_ADDRESS is not a valid address.");
  }

  const rpcUrl = clean(env.VITE_RPC_URL);
  if (rpcUrl && !/^https?:\/\//.test(rpcUrl)) issues.push("VITE_RPC_URL must start with http:// or https://.");

  let deployBlock: number | null = null;
  const rawBlock = clean(env.VITE_DEPLOY_BLOCK);
  if (rawBlock) {
    const parsed = Number(rawBlock);
    if (Number.isInteger(parsed) && parsed >= 0) deployBlock = parsed;
    else issues.push("VITE_DEPLOY_BLOCK must be a non-negative integer.");
  }

  return { chainId, contractAddress, rpcUrl: rpcUrl && /^https?:\/\//.test(rpcUrl) ? rpcUrl : null, deployBlock, issues };
}

/**
 * Show an RPC URL without leaking a possible API key embedded in its path or
 * query string (e.g. https://polygon-amoy.g.alchemy.com/v2/<key>).
 */
export function maskRpcUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const hasSecretLikePart = parsed.pathname.length > 1 || parsed.search.length > 0;
    return `${parsed.protocol}//${parsed.host}${hasSecretLikePart ? "/•••" : ""}`;
  } catch {
    return "(invalid URL)";
  }
}

export const ENV = readEnvConfig();
