/**
 * LOCAL DEMONSTRATION MODE back-end.
 *
 * Wraps the in-memory LocalLedger (same rules as CropLedger.sol, verified by
 * test/parity.test.ts) and persists it in localStorage. Nothing is sent to a
 * blockchain: there are no transaction hashes, no gas and no explorer links.
 * Lifecycle stages are shown with short artificial delays and are labelled
 * as simulated in the UI.
 */
import { decodeError, LedgerRuleError } from "@core/errors.js";
import { validateSignedReading } from "@core/gateway.js";
import { fromBytes32Id } from "@core/ids.js";
import { LOCAL_OPERATOR, LocalLedger, type LocalLedgerSnapshot } from "@core/localLedger.js";
import { LOCAL_DEMO_DOMAIN, toSubmitArgs } from "@core/signing.js";
import type { Hex, SignedReading, SubmitReadingArgs } from "@core/types.js";
import type { DeviceInfo, ReadingView } from "../../types/app";
import { loadJson, saveJson } from "../storage";
import type { LedgerResult, LedgerService, LedgerUpdate, WriteOptions } from "./types";

const STORAGE_KEY = "localLedger.v1";
const SEQ_KEY = "localLedger.seq.v1";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class LocalLedgerService implements LedgerService {
  readonly kind = "local" as const;
  readonly domain = LOCAL_DEMO_DOMAIN;
  readonly chainId = null;
  private ledger: LocalLedger;
  /** Delay multiplier for the simulated lifecycle (0 in tests). */
  private readonly pace: number;
  private readonly persist: boolean;

  constructor(options: { pace?: number; persist?: boolean } = {}) {
    this.pace = options.pace ?? 1;
    this.persist = options.persist ?? true;
    const snapshot = this.persist ? loadJson<LocalLedgerSnapshot | null>(STORAGE_KEY, null) : null;
    try {
      this.ledger = snapshot ? LocalLedger.restore(snapshot) : new LocalLedger();
    } catch {
      this.ledger = new LocalLedger();
    }
  }

  private save(): void {
    if (this.persist) saveJson(STORAGE_KEY, this.ledger.snapshot());
  }

  private nextRef(): string {
    const seq = loadJson<number>(SEQ_KEY, 0) + 1;
    saveJson(SEQ_KEY, seq);
    return `LOCAL-${String(seq).padStart(6, "0")}`;
  }

  async getOwner(): Promise<string> {
    return LOCAL_OPERATOR;
  }

  async listDevices(): Promise<DeviceInfo[]> {
    return this.ledger.listDeviceIds().map((deviceId) => {
      const d = this.ledger.getDevice(deviceId);
      return {
        deviceId,
        label: fromBytes32Id(deviceId),
        signer: d.signer,
        fieldId: d.fieldId,
        fieldLabel: fromBytes32Id(d.fieldId),
        firmwareHash: d.firmwareHash,
        lastNonce: d.lastNonce,
        active: d.active,
        registeredAt: d.registeredAt,
        revokedAt: d.revokedAt,
        readingCount: this.ledger.getReadingCount(deviceId),
      };
    });
  }

  async getReadings(deviceId: Hex, limit = 500): Promise<ReadingView[]> {
    const count = this.ledger.getReadingCount(deviceId);
    if (count === 0) return [];
    const device = this.ledger.getDevice(deviceId);
    const views: ReadingView[] = [];
    for (let index = Math.max(0, count - limit); index < count; index++) {
      const r = this.ledger.getReading(deviceId, index);
      views.push({
        deviceId,
        deviceLabel: fromBytes32Id(deviceId),
        fieldId: device.fieldId,
        fieldLabel: fromBytes32Id(device.fieldId),
        index,
        ...r,
      });
    }
    return views;
  }

  async verifyReading(deviceId: Hex, index: number, payloadHash: Hex): Promise<boolean> {
    return this.ledger.verifyReading(deviceId, index, payloadHash);
  }

  async getTotalReadings(): Promise<number> {
    return this.ledger.totalReadings;
  }

  async submitReading(signed: SignedReading, options: WriteOptions = {}): Promise<LedgerResult> {
    const emit = this.emitter(options);
    emit({ stage: "validating", note: "Gateway checks payload, hash and signature format" });
    try {
      validateSignedReading(signed, this.domain);
    } catch (error) {
      return this.done(emit, { stage: "failed", error: { kind: "validation", message: (error as Error).message } }, false);
    }
    return this.applyWrite(emit, () => this.ledger.submitReading(...toSubmitArgs(signed)));
  }

  async submitRaw(args: SubmitReadingArgs, options: WriteOptions = {}): Promise<LedgerResult> {
    const emit = this.emitter(options);
    emit({ stage: "validating", note: "Raw arguments (gateway checks bypassed for the attack demo)" });
    return this.applyWrite(emit, () => this.ledger.submitReading(...args));
  }

  async registerDevice(deviceId: Hex, signer: string, fieldId: Hex, firmwareHash: Hex, options: WriteOptions = {}): Promise<LedgerResult> {
    const emit = this.emitter(options);
    emit({ stage: "validating" });
    return this.applyWrite(emit, () => this.ledger.registerDevice(deviceId, signer, fieldId, firmwareHash));
  }

  async revokeDevice(deviceId: Hex, options: WriteOptions = {}): Promise<LedgerResult> {
    const emit = this.emitter(options);
    emit({ stage: "validating" });
    return this.applyWrite(emit, () => this.ledger.revokeDevice(deviceId));
  }

  // -------------------------------------------------------------- internals

  private emitter(options: WriteOptions) {
    return (update: Omit<LedgerUpdate, "at">): LedgerUpdate => {
      const full = { ...update, at: Date.now() };
      options.onUpdate?.(full);
      return full;
    };
  }

  private done(emit: ReturnType<LocalLedgerService["emitter"]>, update: Omit<LedgerUpdate, "at">, ok: boolean): LedgerResult {
    return { ...emit(update), ok };
  }

  /**
   * Run a write against a throw-away copy first (the local equivalent of an
   * eth_call preflight), then apply it for real with a simulated lifecycle.
   */
  private async applyWrite(
    emit: ReturnType<LocalLedgerService["emitter"]>,
    write: () => unknown,
  ): Promise<LedgerResult> {
    await sleep(150 * this.pace);
    emit({ stage: "preflight", note: "Rules checked against a copy of the local ledger" });
    const live = this.ledger;
    try {
      this.ledger = LocalLedger.restore(live.snapshot());
      write();
    } catch (error) {
      this.ledger = live;
      return this.done(emit, { stage: "rejected-preflight", error: decodeError(error) }, false);
    } finally {
      if (this.ledger !== live) this.ledger = live;
    }

    await sleep(250 * this.pace);
    const localRef = this.nextRef();
    emit({ stage: "submitted", localRef, note: "Queued in the local demo ledger (no real transaction)" });
    await sleep(700 * this.pace);
    try {
      const result = write() as { index?: number; record?: { blockNumber: bigint } } | undefined;
      this.save();
      return this.done(
        emit,
        {
          stage: "confirmed",
          localRef,
          blockNumber: result?.record ? Number(result.record.blockNumber) : undefined,
          readingIndex: result?.index,
          note: "Recorded in the local demo ledger (simulated block)",
        },
        true,
      );
    } catch (error) {
      // State changed between preflight and apply (e.g. concurrent submissions).
      const decoded = error instanceof LedgerRuleError ? decodeError(error) : { kind: "unknown" as const, message: String(error) };
      return this.done(emit, { stage: "failed", localRef, error: decoded }, false);
    }
  }

  /** Erase all local demo ledger state. */
  static reset(): void {
    saveJson(STORAGE_KEY, null);
    saveJson(SEQ_KEY, 0);
  }
}
