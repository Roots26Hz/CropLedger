/**
 * Fee suggestions for networks with a minimum priority fee (Polygon PoS).
 *
 * Wallets estimate fees from recent blocks. On Amoy most blocks are empty
 * and report a 0 tip, so an estimator can propose less than the 25 gwei
 * Polygon requires; the node then refuses the signed transaction
 * ("transaction underpriced"). Supplying explicit EIP-1559 fees avoids that.
 * MetaMask shows them as "site suggested" and the user can still edit them.
 */
import { formatUnits, parseUnits } from "ethers";
import type { NetworkConfig } from "./networks.js";

export interface FeeOverrides {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  /** Where the tip came from, for display. */
  source: string;
}

/** Minimal provider surface used here (ethers Provider satisfies it). */
export interface FeeProvider {
  getBlock(tag: "latest"): Promise<{ baseFeePerGas: bigint | null } | null>;
  getFeeData(): Promise<{ maxPriorityFeePerGas: bigint | null }>;
}

interface GasStationResponse {
  standard?: { maxPriorityFee?: number };
  estimatedBaseFee?: number;
}

const GWEI = 1_000_000_000n;
const toWei = (gwei: number) => parseUnits(gwei.toFixed(9), "gwei");

export function formatGwei(wei: bigint): string {
  return `${Number(formatUnits(wei, "gwei")).toLocaleString(undefined, { maximumFractionDigits: 2 })} gwei`;
}

async function fetchJson(url: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Suggest EIP-1559 fees that satisfy the network's fee policy, or return
 * undefined for networks without one (the wallet then decides).
 *
 * Tip: Polygon gas station "standard", else the RPC's suggestion, else the
 * floor — never below floor + 20 % and never above 8 × the floor (test
 * tokens are scarce). Max fee: tip + 2 × base fee + 1 gwei of headroom.
 */
export async function suggestFees(
  network: NetworkConfig,
  options: { provider?: FeeProvider; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<FeeOverrides | undefined> {
  const policy = network.feePolicy;
  if (!policy) return undefined;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 5000;

  let tip: bigint | undefined;
  let baseFee = 0n;
  let source = "network minimum";

  if (policy.gasStationUrl && fetchImpl) {
    try {
      const data = (await fetchJson(policy.gasStationUrl, fetchImpl, timeoutMs)) as GasStationResponse;
      if (typeof data.standard?.maxPriorityFee === "number") {
        tip = toWei(data.standard.maxPriorityFee);
        source = "Polygon gas station";
      }
      if (typeof data.estimatedBaseFee === "number") baseFee = toWei(data.estimatedBaseFee);
    } catch {
      // Fall back to the RPC below.
    }
  }

  if (options.provider) {
    try {
      const block = await options.provider.getBlock("latest");
      if (block?.baseFeePerGas != null && block.baseFeePerGas > baseFee) baseFee = block.baseFeePerGas;
    } catch {
      // Keep the gas-station estimate.
    }
    if (tip === undefined) {
      try {
        const data = await options.provider.getFeeData();
        if (data.maxPriorityFeePerGas) {
          tip = data.maxPriorityFeePerGas;
          source = "RPC suggestion";
        }
      } catch {
        // Use the floor.
      }
    }
  }

  const floor = toWei(policy.minPriorityFeeGwei);
  const minimum = floor + floor / 5n;
  const cap = floor * 8n;
  let chosen = tip ?? minimum;
  if (chosen < minimum) chosen = minimum;
  if (chosen > cap) chosen = cap;

  return { maxPriorityFeePerGas: chosen, maxFeePerGas: chosen + baseFee * 2n + GWEI, source };
}
