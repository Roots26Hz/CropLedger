/**
 * Network registry. CropLedger only ever transacts on the chains listed in
 * SUPPORTED_NETWORKS (a public testnet and the local Hardhat node). Any other
 * chain, including every mainnet, is refused, which prevents accidental
 * transactions that would cost real money.
 */

export interface NetworkConfig {
  chainId: number;
  key: "amoy" | "hardhat";
  name: string;
  shortName: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  defaultRpcUrl: string;
  /** Other public endpoints known to work (fallbacks if the default is down). */
  alternativeRpcUrls: string[];
  /** Endpoints that used to serve this chain but have been shut down. */
  retiredRpcUrls: string[];
  /** Block explorer for this exact network (undefined for local chains). */
  explorer?: { name: string; url: string };
  /** Where to obtain test tokens (informational; availability changes). */
  faucets: string[];
  /**
   * Fee rules the network enforces. Polygon PoS nodes reject transactions
   * whose priority fee (tip) is below a fixed floor, even on Amoy.
   */
  feePolicy?: { minPriorityFeeGwei: number; gasStationUrl?: string };
}

export const POLYGON_AMOY: NetworkConfig = {
  chainId: 80002,
  key: "amoy",
  name: "Polygon Amoy Testnet",
  shortName: "Amoy",
  nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
  // Endpoint listed in Polygon's official docs. The former public endpoint
  // rpc-amoy.polygon.technology was shut down in July 2026 (no longer resolves).
  defaultRpcUrl: "https://polygon-amoy.drpc.org",
  alternativeRpcUrls: ["https://polygon-amoy-bor-rpc.publicnode.com", "https://polygon-amoy.gateway.tenderly.co"],
  retiredRpcUrls: ["https://rpc-amoy.polygon.technology"],
  explorer: { name: "PolygonScan (Amoy)", url: "https://amoy.polygonscan.com" },
  faucets: [
    "https://faucet.polygon.technology/",
    "https://www.alchemy.com/faucets/polygon-amoy",
    "https://faucet.quicknode.com/polygon/amoy",
  ],
  // Polygon's gas station reports a 25 gwei minimum priority fee for Amoy;
  // lower tips are refused by the network after the wallet signs.
  feePolicy: { minPriorityFeeGwei: 25, gasStationUrl: "https://gasstation.polygon.technology/amoy" },
};

export const HARDHAT_LOCAL: NetworkConfig = {
  chainId: 31337,
  key: "hardhat",
  name: "Hardhat Local Node",
  shortName: "Hardhat",
  nativeCurrency: { name: "Local test ETH", symbol: "ETH", decimals: 18 },
  defaultRpcUrl: "http://127.0.0.1:8545",
  alternativeRpcUrls: [],
  retiredRpcUrls: [],
  faucets: [],
};

export const SUPPORTED_NETWORKS: Readonly<Record<number, NetworkConfig>> = {
  [POLYGON_AMOY.chainId]: POLYGON_AMOY,
  [HARDHAT_LOCAL.chainId]: HARDHAT_LOCAL,
};

/** Well-known chains, used only to explain wrong-network errors. */
const KNOWN_CHAINS: Readonly<Record<number, string>> = {
  1: "Ethereum Mainnet",
  10: "OP Mainnet",
  56: "BNB Smart Chain",
  137: "Polygon PoS Mainnet",
  1101: "Polygon zkEVM",
  8453: "Base",
  42161: "Arbitrum One",
  11155111: "Ethereum Sepolia",
  80001: "Polygon Mumbai (deprecated)",
};

export function getNetwork(chainId: number | bigint): NetworkConfig | undefined {
  return SUPPORTED_NETWORKS[Number(chainId)];
}

export function isSupportedChain(chainId: number | bigint): boolean {
  return getNetwork(chainId) !== undefined;
}

export function chainLabel(chainId: number | bigint): string {
  const id = Number(chainId);
  return getNetwork(id)?.name ?? KNOWN_CHAINS[id] ?? `Unknown chain ${id}`;
}

/** True if the URL is an endpoint that no longer serves this chain. */
export function isRetiredRpcUrl(chainId: number | bigint, url: string): boolean {
  const normalized = url.trim().replace(/\/+$/, "").toLowerCase();
  return getNetwork(chainId)?.retiredRpcUrls.some((r) => r.toLowerCase() === normalized) ?? false;
}

/** Throws if the chain is not an allowed testnet/local chain. */
export function assertSupportedChain(chainId: number | bigint): NetworkConfig {
  const network = getNetwork(chainId);
  if (!network) {
    throw new Error(
      `${chainLabel(chainId)} (chain ID ${chainId}) is not supported. CropLedger only transacts on Polygon Amoy (80002) or a local Hardhat node (31337).`,
    );
  }
  return network;
}

export function explorerTxUrl(chainId: number | bigint, txHash: string): string | undefined {
  const explorer = getNetwork(chainId)?.explorer;
  return explorer ? `${explorer.url}/tx/${txHash}` : undefined;
}

export function explorerAddressUrl(chainId: number | bigint, address: string): string | undefined {
  const explorer = getNetwork(chainId)?.explorer;
  return explorer ? `${explorer.url}/address/${address}` : undefined;
}

export function explorerBlockUrl(chainId: number | bigint, blockNumber: number | bigint): string | undefined {
  const explorer = getNetwork(chainId)?.explorer;
  return explorer ? `${explorer.url}/block/${blockNumber.toString()}` : undefined;
}

/** Parameters for MetaMask's wallet_addEthereumChain request. */
export function addChainParameters(network: NetworkConfig, rpcUrl = network.defaultRpcUrl) {
  return {
    chainId: `0x${network.chainId.toString(16)}`,
    chainName: network.name,
    nativeCurrency: network.nativeCurrency,
    rpcUrls: [rpcUrl],
    ...(network.explorer ? { blockExplorerUrls: [network.explorer.url] } : {}),
  };
}
