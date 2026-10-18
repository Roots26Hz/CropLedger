import type { AnomalyKind } from "@core/deviceSimulator.js";
import type { DecodedError } from "@core/errors.js";
import type { SubmissionStage } from "@core/gateway.js";
import type { SignedReadingJson } from "@core/serialization.js";
import type { Hex, ReadingPayload } from "@core/types.js";

/** Local demo (in-browser ledger) or a real EVM network (Amoy / Hardhat). */
export type AppMode = "local" | "network";

export interface Settings {
  mode: AppMode;
  /** Chain used in network mode (80002 Amoy or 31337 Hardhat). */
  chainId: number;
  /** Deployed CropLedger address for network mode ("" when not configured). */
  contractAddress: string;
  /** Read-only JSON-RPC endpoint for queries. */
  rpcUrl: string;
  /** Block in which the contract was deployed (optional). */
  deployBlock: number | null;
  /** "env" = derived from .env; "user" = saved from System Configuration. */
  source: "env" | "user";
}

export interface DeviceInfo {
  deviceId: Hex;
  label: string;
  signer: string;
  fieldId: Hex;
  fieldLabel: string;
  firmwareHash: Hex;
  lastNonce: bigint;
  active: boolean;
  registeredAt: bigint;
  revokedAt: bigint;
  readingCount: number;
}

export interface ReadingView {
  deviceId: Hex;
  deviceLabel: string;
  fieldId: Hex;
  fieldLabel: string;
  index: number;
  timestamp: bigint;
  n: number;
  p: number;
  k: number;
  nonce: bigint;
  /** Real block number (network) or simulated block sequence (local demo). */
  blockNumber: bigint;
  payloadHash: Hex;
}

export type TxKind = "submitReading" | "registerDevice" | "revokeDevice" | "attack";

export interface TxStageEvent {
  stage: SubmissionStage;
  at: number;
  /** Extra detail for the lifecycle view (e.g. "eth_call preflight"). */
  note?: string;
}

/** A write operation started from this browser, with its lifecycle. */
export interface TxRecord {
  id: string;
  kind: TxKind;
  label: string;
  /** True for local demo operations (no real transaction exists). */
  local: boolean;
  chainId: number | null;
  deviceId?: Hex;
  deviceLabel?: string;
  nonce?: number;
  stage: SubmissionStage;
  stages: TxStageEvent[];
  txHash?: Hex;
  /** Reference for local demo operations, e.g. LOCAL-000012. */
  localRef?: string;
  blockNumber?: number;
  gasUsed?: string;
  readingIndex?: number;
  error?: DecodedError;
  createdAt: number;
  updatedAt: number;
}

/** A reading produced by the edge simulator in this browser. */
export interface FeedItem {
  id: string;
  deviceLabel: string;
  fieldLabel: string;
  payload: ReadingPayload;
  injected: AnomalyKind | null;
  signed: SignedReadingJson;
  /** Result of verifying the device signature locally right after signing. */
  signatureValid: boolean;
  txId?: string;
  createdAt: number;
}

/** A simulated device key held in this browser (never displayed). */
export interface SimDeviceKey {
  label: string;
  fieldLabel: string;
  firmware: string;
  address: string;
  privateKey: string;
  createdAt: number;
}

export interface BlockSummary {
  number: number;
  timestamp: number;
  hash: string;
  txCount: number;
  gasUsed: bigint;
  gasLimit: bigint;
  miner: string;
}
