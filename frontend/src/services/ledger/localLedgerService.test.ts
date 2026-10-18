import { Wallet } from "ethers";
import { describe, expect, it } from "vitest";
import { EdgeDeviceSimulator } from "@core/deviceSimulator.js";
import { firmwareHashFor, toBytes32Id } from "@core/ids.js";
import { hashPayload } from "@core/payload.js";
import { LOCAL_DEMO_DOMAIN, signReading, toSubmitArgs } from "@core/signing.js";
import { LocalLedgerService } from "./localLedgerService";
import type { LedgerUpdate } from "./types";

async function setup() {
  const service = new LocalLedgerService({ pace: 0, persist: false });
  const key = Wallet.createRandom();
  const deviceId = toBytes32Id("CL-DEV-0001");
  const registered = await service.registerDevice(deviceId, key.address, toBytes32Id("FIELD-A1"), firmwareHashFor("1.4.2"));
  const sim = new EdgeDeviceSimulator({ deviceId: "CL-DEV-0001", fieldId: "FIELD-A1", firmware: "1.4.2" }, { seed: 1 });
  return { service, key, deviceId, sim, registered };
}

describe("LocalLedgerService (local demonstration mode)", () => {
  it("records a signed reading with a simulated lifecycle and no transaction hash", async () => {
    const { service, key, deviceId, sim, registered } = await setup();
    expect(registered.ok).toBe(true);

    const payload = sim.generate().payload;
    const signed = await signReading(key, LOCAL_DEMO_DOMAIN, payload);
    const updates: LedgerUpdate[] = [];
    const result = await service.submitReading(signed, { onUpdate: (u) => updates.push(u) });

    expect(updates.map((u) => u.stage)).toEqual(["validating", "preflight", "submitted", "confirmed"]);
    expect(result.ok).toBe(true);
    expect(result.txHash).toBeUndefined();
    expect(result.localRef).toMatch(/^LOCAL-\d{6}$/);
    expect(result.readingIndex).toBe(0);
    expect(await service.getTotalReadings()).toBe(1);
    expect(await service.verifyReading(deviceId, 0, hashPayload(payload))).toBe(true);
    expect(await service.verifyReading(deviceId, 0, hashPayload({ ...payload, n: payload.n + 1 }))).toBe(false);
  });

  it("rejects a replay in preflight without changing state", async () => {
    const { service, key, sim } = await setup();
    const signed = await signReading(key, LOCAL_DEMO_DOMAIN, sim.generate().payload);
    await service.submitReading(signed);
    const replay = await service.submitReading(signed);
    expect(replay.ok).toBe(false);
    expect(replay.stage).toBe("rejected-preflight");
    expect(replay.error?.name).toBe("StaleNonce");
    expect(await service.getTotalReadings()).toBe(1);
  });

  it("rejects gateway-altered values via submitRaw", async () => {
    const { service, key, sim } = await setup();
    const [id, reading, nonce, signature] = toSubmitArgs(await signReading(key, LOCAL_DEMO_DOMAIN, sim.generate().payload));
    const result = await service.submitRaw([id, { ...reading, n: reading.n + 40 }, nonce, signature]);
    expect(result.error?.name).toBe("InvalidSignature");
  });

  it("fails validation for readings signed for a real deployment", async () => {
    const { service, key, sim } = await setup();
    const signed = await signReading(key, { chainId: 80002n, verifyingContract: "0x5FbDB2315678afecb367f032d93F642f64180aa3" }, sim.generate().payload);
    const result = await service.submitReading(signed);
    expect(result.stage).toBe("failed");
    expect(result.error?.kind).toBe("validation");
  });

  it("keeps history readable after revocation", async () => {
    const { service, key, deviceId, sim } = await setup();
    await service.submitReading(await signReading(key, LOCAL_DEMO_DOMAIN, sim.generate().payload));
    expect((await service.revokeDevice(deviceId)).ok).toBe(true);
    const after = await service.submitReading(await signReading(key, LOCAL_DEMO_DOMAIN, sim.generate().payload));
    expect(after.error?.name).toBe("DeviceNotActive");
    const devices = await service.listDevices();
    expect(devices[0]).toMatchObject({ label: "CL-DEV-0001", active: false, readingCount: 1 });
    expect(await service.getReadings(deviceId)).toHaveLength(1);
  });
});
