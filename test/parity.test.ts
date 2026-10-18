/**
 * Parity between the real contract and the in-browser LocalLedger used by the
 * dashboard's local demonstration mode. Every scenario is replayed against
 * both, and both must accept/reject in exactly the same way (same custom
 * error name). This keeps local mode honest about what the contract does.
 */
import { expect } from "chai";
import { Wallet, ZeroHash, type HDNodeWallet } from "ethers";
import { network } from "hardhat";
import { decodeError } from "../simulator/errors.js";
import { firmwareHashFor, toBytes32Id } from "../simulator/ids.js";
import { LocalLedger } from "../simulator/localLedger.js";
import { hashPayload } from "../simulator/payload.js";
import { READING_TYPES, signReading, toSubmitArgs, typedDataDomain } from "../simulator/signing.js";
import type { DeploymentDomain, Hex, ReadingPayload, SubmitReadingArgs } from "../simulator/types.js";

const { ethers, networkHelpers } = await network.create();

type Outcome = "ok" | string;

interface Harness {
  domain: DeploymentDomain;
  submit(args: SubmitReadingArgs): Promise<Outcome>;
  register(id: Hex, signer: string): Promise<Outcome>;
  revoke(id: Hex): Promise<Outcome>;
  verify(id: Hex, index: number, hash: Hex): Promise<boolean | string>;
}

async function outcome(fn: () => Promise<unknown> | unknown): Promise<Outcome> {
  try {
    await fn();
    return "ok";
  } catch (error) {
    return decodeError(error).name ?? `unexpected: ${decodeError(error).message}`;
  }
}

async function contractHarness(): Promise<Harness> {
  const [owner, gateway] = await ethers.getSigners();
  const ledger = await ethers.deployContract("CropLedger", [owner.address]);
  const { chainId } = await ethers.provider.getNetwork();
  const domain = { chainId, verifyingContract: await ledger.getAddress() };
  return {
    domain,
    submit: (args) => outcome(async () => (await ledger.connect(gateway).submitReading(...args)).wait()),
    register: (id, signer) => outcome(async () => (await ledger.registerDevice(id, signer, toBytes32Id("FIELD-A1"), firmwareHashFor("1.4.2"))).wait()),
    revoke: (id) => outcome(async () => (await ledger.revokeDevice(id)).wait()),
    verify: async (id, index, hash) => {
      try {
        return await ledger.verifyReading(id, index, hash);
      } catch (error) {
        return decodeError(error).name ?? "error";
      }
    },
  };
}

async function localHarness(): Promise<Harness> {
  // Use chain time so timestamp rules are evaluated against the same clock.
  const now = await networkHelpers.time.latest();
  const ledger = new LocalLedger({ now: () => now + 1 });
  return {
    domain: ledger.domain,
    submit: (args) => outcome(() => ledger.submitReading(...args)),
    register: (id, signer) => outcome(() => ledger.registerDevice(id, signer, toBytes32Id("FIELD-A1"), firmwareHashFor("1.4.2"))),
    revoke: (id) => outcome(() => ledger.revokeDevice(id)),
    verify: async (id, index, hash) => {
      try {
        return ledger.verifyReading(id, index, hash);
      } catch (error) {
        return decodeError(error).name ?? "error";
      }
    },
  };
}

const DEVICE_ID = toBytes32Id("CL-DEV-0001");

async function payload(nonce: number, overrides: Partial<ReadingPayload> = {}): Promise<ReadingPayload> {
  return {
    schema: "cropledger.reading.v1",
    deviceId: "CL-DEV-0001",
    fieldId: "FIELD-A1",
    firmware: "1.4.2",
    timestamp: await networkHelpers.time.latest(),
    nonce,
    n: 150,
    p: 33,
    k: 180,
    soilMoistureBp: 3100,
    soilTempCentiC: 2700,
    phCenti: 660,
    anomalyScoreMilli: 0,
    anomalyLabel: "normal",
    ...overrides,
  };
}

/** Runs one scripted scenario and returns the list of outcomes. */
async function runScenario(h: Harness, device: HDNodeWallet): Promise<(Outcome | boolean)[]> {
  const results: (Outcome | boolean)[] = [];
  const sign = async (nonce: number, overrides: Partial<ReadingPayload> = {}, key: HDNodeWallet = device) =>
    signReading(key, h.domain, await payload(nonce, overrides));

  // Unregistered device.
  results.push(await h.submit(toSubmitArgs(await sign(1))));
  results.push(await h.register(DEVICE_ID, device.address));
  // Duplicate registration.
  results.push(await h.register(DEVICE_ID, Wallet.createRandom().address));

  // Valid reading, then replay, stale nonce and forged key.
  const first = await sign(1);
  results.push(await h.submit(toSubmitArgs(first)));
  results.push(await h.submit(toSubmitArgs(first)));
  const second = await sign(4);
  results.push(await h.submit(toSubmitArgs(second)));
  results.push(await h.submit(toSubmitArgs(await sign(3))));
  results.push(await h.submit(toSubmitArgs(await sign(5, {}, Wallet.createRandom()))));

  // Gateway alters a value after signing.
  const [id, reading, nonce, signature] = toSubmitArgs(await sign(6));
  results.push(await h.submit([id, { ...reading, k: reading.k + 1 }, nonce, signature]));

  // Raw-message edge cases (bypass payload validation).
  const raw = async (overrides: Partial<Record<"timestamp" | "n" | "payloadHash", unknown>>) => {
    const message = {
      deviceId: DEVICE_ID,
      fieldId: toBytes32Id("FIELD-A1"),
      timestamp: BigInt(await networkHelpers.time.latest()),
      n: 10,
      p: 10,
      k: 10,
      nonce: 50n,
      payloadHash: hashPayload(await payload(50)),
      ...overrides,
    };
    const sig = (await device.signTypedData(typedDataDomain(h.domain), READING_TYPES, message)) as Hex;
    return h.submit(toSubmitArgs({ message: message as never, signature: sig }));
  };
  results.push(await raw({ timestamp: 0n }));
  results.push(await raw({ n: 20_000 }));
  results.push(await raw({ payloadHash: ZeroHash }));

  // Verification of genuine vs tampered payloads.
  const firstPayload = first.payload;
  results.push(await h.verify(DEVICE_ID, 0, hashPayload(firstPayload)));
  results.push(await h.verify(DEVICE_ID, 0, hashPayload({ ...firstPayload, p: firstPayload.p + 2 })));
  results.push(await h.verify(DEVICE_ID, 9, hashPayload(firstPayload)));

  // Revocation.
  results.push(await h.revoke(DEVICE_ID));
  results.push(await h.submit(toSubmitArgs(await sign(7))));
  results.push(await h.revoke(DEVICE_ID));
  results.push(await h.verify(DEVICE_ID, 1, second.payloadHash));
  return results;
}

describe("LocalLedger parity with CropLedger.sol", function () {
  it("accepts and rejects exactly the same submissions", async function () {
    const device = Wallet.createRandom();
    const onChain = await runScenario(await contractHarness(), device);
    const local = await runScenario(await localHarness(), device);

    expect(onChain).to.deep.equal([
      "UnknownDevice",
      "ok",
      "DeviceAlreadyRegistered",
      "ok",
      "StaleNonce",
      "ok",
      "StaleNonce",
      "InvalidSignature",
      "InvalidSignature",
      "InvalidTimestamp",
      "NutrientValueOutOfRange",
      "InvalidPayloadHash",
      true,
      false,
      "ReadingIndexOutOfBounds",
      "ok",
      "DeviceNotActive",
      "DeviceNotActive",
      true,
    ]);
    expect(local).to.deep.equal(onChain);
  });
});
