/**
 * LocalLedger — an in-memory re-implementation of the CropLedger contract
 * rules, used by the dashboard's LOCAL DEMONSTRATION MODE and by the CLI's
 * dry-run mode.
 *
 * It is NOT a blockchain: there is no network, no consensus, no gas and no
 * transaction hash. It exists so the signing, replay, revocation and
 * tamper-detection logic can be demonstrated without a wallet or testnet.
 * test/parity.test.ts runs the same scenarios against this class and the real
 * contract and requires identical accept/reject outcomes.
 */
import { ZeroAddress, ZeroHash } from "ethers";
import { LedgerRuleError } from "./errors.js";
import { MAX_NUTRIENT_VALUE } from "./payload.js";
import { LOCAL_DEMO_DOMAIN, recoverReadingSigner } from "./signing.js";
import type { DeploymentDomain, Hex, SubmitReadingArgs } from "./types.js";

/** Mirrors CropLedger.MAX_FUTURE_DRIFT (15 minutes). */
export const MAX_FUTURE_DRIFT_SECONDS = 15 * 60;

/** Pseudo-owner identity used for registry actions in local demo mode. */
export const LOCAL_OPERATOR = "local-demo-operator";

export interface LocalDevice {
  signer: string;
  lastNonce: bigint;
  active: boolean;
  registeredAt: bigint;
  revokedAt: bigint;
  fieldId: Hex;
  firmwareHash: Hex;
}

export interface LocalReadingRecord {
  timestamp: bigint;
  n: number;
  p: number;
  k: number;
  nonce: bigint;
  /** Sequence number of the simulated block (local demo only, not a real block). */
  blockNumber: bigint;
  payloadHash: Hex;
}

export interface LocalSubmission {
  index: number;
  record: LocalReadingRecord;
  submitter: string;
}

export interface LocalLedgerOptions {
  owner?: string;
  domain?: DeploymentDomain;
  /** Current time in seconds (defaults to the system clock). */
  now?: () => number;
}

/** Serializable snapshot, used to persist local demo state in localStorage. */
export interface LocalLedgerSnapshot {
  version: 1;
  simulatedBlock: string;
  deviceIds: Hex[];
  devices: Record<string, Omit<LocalDevice, "lastNonce" | "registeredAt" | "revokedAt"> & {
    lastNonce: string;
    registeredAt: string;
    revokedAt: string;
  }>;
  readings: Record<string, (Omit<LocalReadingRecord, "timestamp" | "nonce" | "blockNumber"> & {
    timestamp: string;
    nonce: string;
    blockNumber: string;
  })[]>;
}

export class LocalLedger {
  readonly owner: string;
  readonly domain: DeploymentDomain;
  private readonly now: () => number;
  private readonly devices = new Map<string, LocalDevice>();
  private readonly readings = new Map<string, LocalReadingRecord[]>();
  private readonly signerToDevice = new Map<string, Hex>();
  private readonly deviceIds: Hex[] = [];
  private simulatedBlock = 0n;

  constructor(options: LocalLedgerOptions = {}) {
    this.owner = options.owner ?? LOCAL_OPERATOR;
    this.domain = options.domain ?? LOCAL_DEMO_DOMAIN;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
  }

  // ---------------------------------------------------------------- registry

  registerDevice(deviceId: Hex, signer: string, fieldId: Hex, firmwareHash: Hex, caller = this.owner): void {
    this.requireOwner(caller);
    if (deviceId === ZeroHash) throw new LedgerRuleError("InvalidDeviceId");
    if (signer === ZeroAddress) throw new LedgerRuleError("InvalidSigner");
    if (fieldId === ZeroHash) throw new LedgerRuleError("InvalidFieldId");
    if (firmwareHash === ZeroHash) throw new LedgerRuleError("InvalidFirmwareHash");
    const key = deviceId.toLowerCase();
    if (this.devices.has(key)) throw new LedgerRuleError("DeviceAlreadyRegistered", [deviceId]);
    const existing = this.signerToDevice.get(signer.toLowerCase());
    if (existing) throw new LedgerRuleError("SignerAlreadyAssigned", [signer, existing]);

    this.devices.set(key, {
      signer,
      lastNonce: 0n,
      active: true,
      registeredAt: BigInt(this.now()),
      revokedAt: 0n,
      fieldId,
      firmwareHash,
    });
    this.signerToDevice.set(signer.toLowerCase(), deviceId);
    this.deviceIds.push(deviceId);
    this.readings.set(key, []);
  }

  revokeDevice(deviceId: Hex, caller = this.owner): void {
    this.requireOwner(caller);
    const device = this.requireDevice(deviceId);
    if (!device.active) throw new LedgerRuleError("DeviceNotActive", [deviceId]);
    device.active = false;
    device.revokedAt = BigInt(this.now());
  }

  updateFirmwareHash(deviceId: Hex, newFirmwareHash: Hex, caller = this.owner): void {
    this.requireOwner(caller);
    const device = this.requireDevice(deviceId);
    if (!device.active) throw new LedgerRuleError("DeviceNotActive", [deviceId]);
    if (newFirmwareHash === ZeroHash) throw new LedgerRuleError("InvalidFirmwareHash");
    device.firmwareHash = newFirmwareHash;
  }

  // -------------------------------------------------------------- submission

  /** Same checks, in the same order, as CropLedger.submitReading. */
  submitReading(...[deviceId, r, nonce, signature, submitter = "local-gateway"]: [...SubmitReadingArgs, string?]): LocalSubmission {
    const device = this.requireDevice(deviceId);
    if (!device.active) throw new LedgerRuleError("DeviceNotActive", [deviceId]);
    if (nonce <= device.lastNonce) throw new LedgerRuleError("StaleNonce", [deviceId, nonce, device.lastNonce]);

    if (r.timestamp === 0n || r.timestamp > BigInt(this.now() + MAX_FUTURE_DRIFT_SECONDS)) {
      throw new LedgerRuleError("InvalidTimestamp", [r.timestamp]);
    }
    if (r.n > MAX_NUTRIENT_VALUE || r.p > MAX_NUTRIENT_VALUE || r.k > MAX_NUTRIENT_VALUE) {
      throw new LedgerRuleError("NutrientValueOutOfRange", [r.n, r.p, r.k]);
    }
    if (r.payloadHash === ZeroHash) throw new LedgerRuleError("InvalidPayloadHash");

    let recovered: string | undefined;
    try {
      recovered = recoverReadingSigner(
        this.domain,
        { deviceId, fieldId: device.fieldId, timestamp: r.timestamp, n: r.n, p: r.p, k: r.k, nonce, payloadHash: r.payloadHash },
        signature,
      );
    } catch {
      recovered = undefined; // malformed signature
    }
    if (!recovered || recovered.toLowerCase() !== device.signer.toLowerCase()) {
      throw new LedgerRuleError("InvalidSignature", [deviceId]);
    }

    device.lastNonce = nonce;
    this.simulatedBlock += 1n;
    const record: LocalReadingRecord = {
      timestamp: r.timestamp,
      n: r.n,
      p: r.p,
      k: r.k,
      nonce,
      blockNumber: this.simulatedBlock,
      payloadHash: r.payloadHash,
    };
    const history = this.readings.get(deviceId.toLowerCase())!;
    history.push(record);
    return { index: history.length - 1, record, submitter };
  }

  // ------------------------------------------------------------------ views

  getDevice(deviceId: Hex): LocalDevice {
    return { ...this.requireDevice(deviceId) };
  }

  isDeviceActive(deviceId: Hex): boolean {
    return this.devices.get(deviceId.toLowerCase())?.active ?? false;
  }

  getDeviceCount(): number {
    return this.deviceIds.length;
  }

  deviceIdAt(index: number): Hex {
    const id = this.deviceIds[index];
    if (id === undefined) throw new LedgerRuleError("DeviceIndexOutOfBounds", [index, this.deviceIds.length]);
    return id;
  }

  listDeviceIds(): Hex[] {
    return [...this.deviceIds];
  }

  getReadingCount(deviceId: Hex): number {
    return this.readings.get(deviceId.toLowerCase())?.length ?? 0;
  }

  getReading(deviceId: Hex, index: number): LocalReadingRecord {
    return { ...this.readingAt(deviceId, index) };
  }

  verifyReading(deviceId: Hex, index: number, payloadHash: string): boolean {
    return this.readingAt(deviceId, index).payloadHash.toLowerCase() === payloadHash.toLowerCase();
  }

  get totalReadings(): number {
    let total = 0;
    for (const history of this.readings.values()) total += history.length;
    return total;
  }

  // ------------------------------------------------------------ persistence

  snapshot(): LocalLedgerSnapshot {
    const devices: LocalLedgerSnapshot["devices"] = {};
    for (const [key, d] of this.devices) {
      devices[key] = { ...d, lastNonce: d.lastNonce.toString(), registeredAt: d.registeredAt.toString(), revokedAt: d.revokedAt.toString() };
    }
    const readings: LocalLedgerSnapshot["readings"] = {};
    for (const [key, list] of this.readings) {
      readings[key] = list.map((r) => ({
        ...r,
        timestamp: r.timestamp.toString(),
        nonce: r.nonce.toString(),
        blockNumber: r.blockNumber.toString(),
      }));
    }
    return { version: 1, simulatedBlock: this.simulatedBlock.toString(), deviceIds: [...this.deviceIds], devices, readings };
  }

  static restore(snapshot: LocalLedgerSnapshot, options: LocalLedgerOptions = {}): LocalLedger {
    if (snapshot.version !== 1) throw new Error("Unsupported local ledger snapshot version");
    const ledger = new LocalLedger(options);
    ledger.simulatedBlock = BigInt(snapshot.simulatedBlock);
    for (const id of snapshot.deviceIds) ledger.deviceIds.push(id);
    for (const [key, d] of Object.entries(snapshot.devices)) {
      ledger.devices.set(key, {
        ...d,
        lastNonce: BigInt(d.lastNonce),
        registeredAt: BigInt(d.registeredAt),
        revokedAt: BigInt(d.revokedAt),
      });
      ledger.signerToDevice.set(d.signer.toLowerCase(), ledger.deviceIds.find((id) => id.toLowerCase() === key) ?? (key as Hex));
    }
    for (const [key, list] of Object.entries(snapshot.readings)) {
      ledger.readings.set(
        key,
        list.map((r) => ({ ...r, timestamp: BigInt(r.timestamp), nonce: BigInt(r.nonce), blockNumber: BigInt(r.blockNumber) })),
      );
    }
    return ledger;
  }

  // ---------------------------------------------------------------- helpers

  private requireOwner(caller: string): void {
    if (caller !== this.owner) throw new LedgerRuleError("OwnableUnauthorizedAccount", [caller]);
  }

  private requireDevice(deviceId: Hex): LocalDevice {
    const device = this.devices.get(deviceId.toLowerCase());
    if (!device) throw new LedgerRuleError("UnknownDevice", [deviceId]);
    return device;
  }

  private readingAt(deviceId: Hex, index: number): LocalReadingRecord {
    const history = this.readings.get(deviceId.toLowerCase()) ?? [];
    const record = history[index];
    if (record === undefined) throw new LedgerRuleError("ReadingIndexOutOfBounds", [deviceId, index, history.length]);
    return record;
  }
}
