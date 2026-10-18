import { Wallet } from "ethers";
import { describe, expect, it } from "vitest";
import { LedgerRuleError } from "../errors.js";
import { firmwareHashFor, toBytes32Id } from "../ids.js";
import { LocalLedger } from "../localLedger.js";
import { hashPayload } from "../payload.js";
import { LOCAL_DEMO_DOMAIN, signReading, toSubmitArgs } from "../signing.js";
import type { ReadingPayload } from "../types.js";
import { SAMPLE } from "./fixtures.js";

const NOW = 1_760_000_100;
const DEVICE_ID = toBytes32Id("CL-DEV-0001");
const FIELD_ID = toBytes32Id("FIELD-A1");

function setup() {
  const ledger = new LocalLedger({ now: () => NOW });
  const device = Wallet.createRandom();
  ledger.registerDevice(DEVICE_ID, device.address, FIELD_ID, firmwareHashFor("1.4.2"));
  const sign = (overrides: Partial<ReadingPayload> = {}) =>
    signReading(device, LOCAL_DEMO_DOMAIN, { ...SAMPLE, ...overrides });
  return { ledger, device, sign };
}

function expectRule(fn: () => unknown, name: string) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(LedgerRuleError);
    expect((error as LedgerRuleError).errorName).toBe(name);
    return;
  }
  throw new Error(`Expected ${name} to be thrown`);
}

describe("LocalLedger (local demonstration mode)", () => {
  it("records and verifies a genuine reading", async () => {
    const { ledger, sign } = setup();
    const signed = await sign();
    const { index, record } = ledger.submitReading(...toSubmitArgs(signed));
    expect(index).toBe(0);
    expect(record.n).toBe(SAMPLE.n);
    expect(record.blockNumber).toBe(1n);
    expect(ledger.getReadingCount(DEVICE_ID)).toBe(1);
    expect(ledger.totalReadings).toBe(1);
    expect(ledger.verifyReading(DEVICE_ID, 0, hashPayload(SAMPLE))).toBe(true);
    expect(ledger.verifyReading(DEVICE_ID, 0, hashPayload({ ...SAMPLE, n: SAMPLE.n + 1 }))).toBe(false);
  });

  it("rejects replays, unknown devices, forged and revoked submissions", async () => {
    const { ledger, sign } = setup();
    const signed = await sign();
    ledger.submitReading(...toSubmitArgs(signed));
    expectRule(() => ledger.submitReading(...toSubmitArgs(signed)), "StaleNonce");

    const rogue = await signReading(Wallet.createRandom(), LOCAL_DEMO_DOMAIN, { ...SAMPLE, deviceId: "ROGUE-01", nonce: 2 });
    expectRule(() => ledger.submitReading(...toSubmitArgs(rogue)), "UnknownDevice");

    const next = await sign({ nonce: 2 });
    const [id, reading, nonce, signature] = toSubmitArgs(next);
    expectRule(() => ledger.submitReading(id, { ...reading, n: reading.n + 9 }, nonce, signature), "InvalidSignature");
    expectRule(() => ledger.submitReading(id, reading, nonce, "0x1234"), "InvalidSignature");

    ledger.revokeDevice(DEVICE_ID);
    expectRule(() => ledger.submitReading(...toSubmitArgs(next)), "DeviceNotActive");
    expect(ledger.getReadingCount(DEVICE_ID)).toBe(1);
  });

  it("enforces registry rules", () => {
    const { ledger, device } = setup();
    expectRule(() => ledger.registerDevice(DEVICE_ID, Wallet.createRandom().address, FIELD_ID, firmwareHashFor("x")), "DeviceAlreadyRegistered");
    expectRule(
      () => ledger.registerDevice(toBytes32Id("CL-DEV-0002"), device.address, FIELD_ID, firmwareHashFor("x")),
      "SignerAlreadyAssigned",
    );
    expectRule(
      () => ledger.registerDevice(toBytes32Id("CL-DEV-0003"), Wallet.createRandom().address, FIELD_ID, firmwareHashFor("x"), "someone-else"),
      "OwnableUnauthorizedAccount",
    );
    expectRule(() => ledger.getReading(DEVICE_ID, 0), "ReadingIndexOutOfBounds");
  });

  it("survives a snapshot/restore round trip", async () => {
    const { ledger, device, sign } = setup();
    const signed = await sign();
    ledger.submitReading(...toSubmitArgs(signed));
    const json = JSON.parse(JSON.stringify(ledger.snapshot()));
    const restored = LocalLedger.restore(json, { now: () => NOW });
    expect(restored.getReadingCount(DEVICE_ID)).toBe(1);
    expect(restored.getDevice(DEVICE_ID).lastNonce).toBe(1n);
    expect(restored.verifyReading(DEVICE_ID, 0, hashPayload(SAMPLE))).toBe(true);
    // Replay protection and signer uniqueness persist across the restore.
    expectRule(() => restored.submitReading(...toSubmitArgs(signed)), "StaleNonce");
    expectRule(
      () => restored.registerDevice(toBytes32Id("CL-DEV-0009"), device.address, FIELD_ID, firmwareHashFor("x")),
      "SignerAlreadyAssigned",
    );
    restored.submitReading(...toSubmitArgs(await sign({ nonce: 2 })));
    expect(restored.getReading(DEVICE_ID, 1).blockNumber).toBe(2n);
  });
});
