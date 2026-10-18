import type { SubmissionResult, SubmissionUpdate } from "@core/gateway.js";
import type { DeploymentDomain, Hex, SignedReading, SubmitReadingArgs } from "@core/types.js";
import type { BlockSummary, DeviceInfo, ReadingView } from "../../types/app";

/** Local demo submissions carry a local reference instead of a tx hash. */
export type LedgerUpdate = SubmissionUpdate & { localRef?: string; note?: string };
export type LedgerResult = SubmissionResult & { localRef?: string };

export interface WriteOptions {
  onUpdate?: (update: LedgerUpdate) => void;
  /** Network mode only: skip preflight and broadcast (records an on-chain failure, costs gas). */
  forceBroadcast?: boolean;
}

/**
 * Common interface for the two ledger back-ends, so UI components never care
 * whether they talk to the real contract or to the local demo ledger.
 */
export interface LedgerService {
  readonly kind: "local" | "evm";
  /** EIP-712 domain readings must be signed for. */
  readonly domain: DeploymentDomain;
  /** Chain ID for real networks, null for local demo mode. */
  readonly chainId: number | null;

  getOwner(): Promise<string>;
  listDevices(): Promise<DeviceInfo[]>;
  getReadings(deviceId: Hex, limit?: number): Promise<ReadingView[]>;
  verifyReading(deviceId: Hex, index: number, payloadHash: Hex): Promise<boolean>;
  getTotalReadings(): Promise<number>;

  submitReading(signed: SignedReading, options?: WriteOptions): Promise<LedgerResult>;
  /** Submit raw arguments without gateway validation (attack demonstrations only). */
  submitRaw(args: SubmitReadingArgs, options?: WriteOptions): Promise<LedgerResult>;
  registerDevice(deviceId: Hex, signer: string, fieldId: Hex, firmwareHash: Hex, options?: WriteOptions): Promise<LedgerResult>;
  revokeDevice(deviceId: Hex, options?: WriteOptions): Promise<LedgerResult>;

  /** Network mode: find the transaction that recorded a reading. */
  findReadingTransaction?(deviceId: Hex, index: number, blockNumber: bigint): Promise<{ txHash: Hex; gasUsed: bigint; from: string } | null>;
  getBlockNumber?(): Promise<number>;
  /** Network mode: native-token balance of an address (wei). */
  getBalance?(address: string): Promise<bigint>;
  getRecentBlocks?(count: number): Promise<BlockSummary[]>;
  getBlock?(blockNumber: number): Promise<BlockSummary | null>;
}
