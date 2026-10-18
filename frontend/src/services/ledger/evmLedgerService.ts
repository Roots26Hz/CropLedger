/**
 * Network back-end: talks to a real CropLedger deployment (Polygon Amoy or a
 * local Hardhat node). Reads go through a read-only JSON-RPC provider so the
 * dashboard works without a wallet; writes are signed by the connected
 * MetaMask account, which acts as the gateway and pays gas.
 */
import { Contract, JsonRpcProvider, Network, type Signer } from "ethers";
import type { DecodedError } from "@core/errors.js";
import { suggestFees } from "@core/fees.js";
import { Gateway, cropLedgerContract, sendTracked, type SubmitOptions } from "@core/gateway.js";
import { fromBytes32Id } from "@core/ids.js";
import { assertSupportedChain, chainLabel, type NetworkConfig } from "@core/networks.js";
import type { Hex, SignedReading, SubmitReadingArgs } from "@core/types.js";
import type { BlockSummary, DeviceInfo, ReadingView } from "../../types/app";
import type { LedgerResult, LedgerService, WriteOptions } from "./types";

interface DeviceStruct {
  signer: string;
  lastNonce: bigint;
  active: boolean;
  registeredAt: bigint;
  revokedAt: bigint;
  fieldId: string;
  firmwareHash: string;
}

interface ReadingStruct {
  timestamp: bigint;
  n: bigint;
  p: bigint;
  k: bigint;
  nonce: bigint;
  blockNumber: bigint;
  payloadHash: string;
}

/** Provides a signer from the connected wallet, or explains why it cannot. */
export type SignerSource = () => Promise<{ signer: Signer; chainId: number } | { error: DecodedError }>;

export class EvmLedgerService implements LedgerService {
  readonly kind = "evm" as const;
  readonly chainId: number;
  readonly domain;
  readonly provider: JsonRpcProvider;
  readonly network: NetworkConfig;
  readonly contract: Contract;
  private readonly getSigner: SignerSource;

  constructor(options: { chainId: number; address: string; rpcUrl: string; signerSource: SignerSource }) {
    this.network = assertSupportedChain(options.chainId);
    this.chainId = options.chainId;
    this.domain = { chainId: BigInt(options.chainId), verifyingContract: options.address };
    // staticNetwork: trust the configured chain and skip eth_chainId on every
    // request; diagnostics verify the RPC's real chain ID separately.
    this.provider = new JsonRpcProvider(options.rpcUrl, Network.from(options.chainId), { staticNetwork: true });
    this.contract = cropLedgerContract(options.address, this.provider);
    this.getSigner = options.signerSource;
  }

  async getOwner(): Promise<string> {
    return (await this.contract.getFunction("owner")()) as string;
  }

  async listDevices(): Promise<DeviceInfo[]> {
    const count = Number(await this.contract.getFunction("getDeviceCount")());
    const ids = (await Promise.all(
      Array.from({ length: count }, (_, i) => this.contract.getFunction("deviceIdAt")(i)),
    )) as Hex[];
    return Promise.all(
      ids.map(async (deviceId) => {
        const [d, readingCount] = (await Promise.all([
          this.contract.getFunction("getDevice")(deviceId),
          this.contract.getFunction("getReadingCount")(deviceId),
        ])) as [DeviceStruct, bigint];
        return {
          deviceId,
          label: fromBytes32Id(deviceId),
          signer: d.signer,
          fieldId: d.fieldId as Hex,
          fieldLabel: fromBytes32Id(d.fieldId),
          firmwareHash: d.firmwareHash as Hex,
          lastNonce: d.lastNonce,
          active: d.active,
          registeredAt: d.registeredAt,
          revokedAt: d.revokedAt,
          readingCount: Number(readingCount),
        };
      }),
    );
  }

  async getReadings(deviceId: Hex, limit = 200): Promise<ReadingView[]> {
    const [count, device] = await Promise.all([
      this.contract.getFunction("getReadingCount")(deviceId) as Promise<bigint>,
      (this.contract.getFunction("getDevice")(deviceId) as Promise<DeviceStruct>).catch(() => null),
    ]);
    const total = Number(count);
    if (total === 0 || !device) return [];
    const start = Math.max(0, total - limit);
    const records = (await Promise.all(
      Array.from({ length: total - start }, (_, i) => this.contract.getFunction("getReading")(deviceId, start + i)),
    )) as ReadingStruct[];
    return records.map((r, i) => ({
      deviceId,
      deviceLabel: fromBytes32Id(deviceId),
      fieldId: device.fieldId as Hex,
      fieldLabel: fromBytes32Id(device.fieldId),
      index: start + i,
      timestamp: r.timestamp,
      n: Number(r.n),
      p: Number(r.p),
      k: Number(r.k),
      nonce: r.nonce,
      blockNumber: r.blockNumber,
      payloadHash: r.payloadHash as Hex,
    }));
  }

  async verifyReading(deviceId: Hex, index: number, payloadHash: Hex): Promise<boolean> {
    return (await this.contract.getFunction("verifyReading")(deviceId, index, payloadHash)) as boolean;
  }

  async getTotalReadings(): Promise<number> {
    return Number(await this.contract.getFunction("totalReadings")());
  }

  // ------------------------------------------------------------------ writes

  /**
   * Options for every write: network-compliant fees (Polygon's minimum
   * priority fee on Amoy) and the read RPC as an independent provider for
   * following a transaction if the wallet's provider fails after broadcast.
   */
  private sendOptions(options: WriteOptions): SubmitOptions {
    return {
      ...options,
      fees: () => suggestFees(this.network, { provider: this.provider }),
      receiptProvider: this.provider,
    };
  }

  /** Connect the contract to the wallet signer after checking the network. */
  private async writable(options: WriteOptions): Promise<{ contract: Contract } | { result: LedgerResult }> {
    const source = await this.getSigner();
    if ("error" in source) {
      const result: LedgerResult = { ok: false, stage: "failed", at: Date.now(), error: source.error };
      options.onUpdate?.(result);
      return { result };
    }
    if (source.chainId !== this.chainId) {
      const result: LedgerResult = {
        ok: false,
        stage: "failed",
        at: Date.now(),
        error: {
          kind: "wrong-network",
          message: `Your wallet is on ${chainLabel(source.chainId)}. Switch to ${chainLabel(this.chainId)} to continue.`,
        },
      };
      options.onUpdate?.(result);
      return { result };
    }
    return { contract: this.contract.connect(source.signer) as Contract };
  }

  async submitReading(signed: SignedReading, options: WriteOptions = {}): Promise<LedgerResult> {
    const w = await this.writable(options);
    if ("result" in w) return w.result;
    return new Gateway(w.contract, this.domain).submit(signed, this.sendOptions(options));
  }

  async submitRaw(args: SubmitReadingArgs, options: WriteOptions = {}): Promise<LedgerResult> {
    const w = await this.writable(options);
    if ("result" in w) return w.result;
    options.onUpdate?.({ stage: "validating", at: Date.now(), note: "Raw arguments (gateway checks bypassed for the attack demo)" });
    return sendTracked(w.contract, "submitReading", args, this.sendOptions(options));
  }

  async registerDevice(deviceId: Hex, signer: string, fieldId: Hex, firmwareHash: Hex, options: WriteOptions = {}): Promise<LedgerResult> {
    const w = await this.writable(options);
    if ("result" in w) return w.result;
    options.onUpdate?.({ stage: "validating", at: Date.now() });
    return sendTracked(w.contract, "registerDevice", [deviceId, signer, fieldId, firmwareHash], this.sendOptions(options));
  }

  async revokeDevice(deviceId: Hex, options: WriteOptions = {}): Promise<LedgerResult> {
    const w = await this.writable(options);
    if ("result" in w) return w.result;
    options.onUpdate?.({ stage: "validating", at: Date.now() });
    return sendTracked(w.contract, "revokeDevice", [deviceId], this.sendOptions(options));
  }

  // ---------------------------------------------------------- chain queries

  async findReadingTransaction(deviceId: Hex, index: number, blockNumber: bigint) {
    const filter = this.contract.filters.ReadingRecorded!(deviceId, null, index);
    const logs = await this.contract.queryFilter(filter, Number(blockNumber), Number(blockNumber));
    const log = logs[0];
    if (!log) return null;
    const receipt = await this.provider.getTransactionReceipt(log.transactionHash);
    return { txHash: log.transactionHash as Hex, gasUsed: receipt?.gasUsed ?? 0n, from: receipt?.from ?? "" };
  }

  async getBlockNumber(): Promise<number> {
    return this.provider.getBlockNumber();
  }

  async getRecentBlocks(count: number): Promise<BlockSummary[]> {
    const latest = await this.provider.getBlockNumber();
    const numbers = Array.from({ length: Math.min(count, latest + 1) }, (_, i) => latest - i);
    const blocks = await Promise.all(numbers.map((n) => this.getBlock(n)));
    return blocks.filter((b): b is BlockSummary => b !== null);
  }

  async getBlock(blockNumber: number): Promise<BlockSummary | null> {
    const b = await this.provider.getBlock(blockNumber);
    if (!b) return null;
    return {
      number: b.number,
      timestamp: b.timestamp,
      hash: b.hash ?? "",
      txCount: b.transactions.length,
      gasUsed: b.gasUsed,
      gasLimit: b.gasLimit,
      miner: b.miner,
    };
  }
}
