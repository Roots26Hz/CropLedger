import { Wallet } from "ethers";
import { describe, expect, it } from "vitest";
import { fromBytes32Id, toBytes32Id } from "../ids.js";
import {
  LOCAL_DEMO_DOMAIN,
  READING_TYPEHASH,
  messageFromPayload,
  readingDigest,
  recoverReadingSigner,
  signReading,
  toSubmitArgs,
} from "../signing.js";
import type { DeploymentDomain } from "../types.js";
import { SAMPLE } from "./fixtures.js";

const DOMAIN: DeploymentDomain = {
  chainId: 80002n,
  verifyingContract: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
};

describe("EIP-712 reading signatures", () => {
  it("exposes the Solidity type hash", () => {
    // keccak256("Reading(bytes32 deviceId,bytes32 fieldId,uint64 timestamp,uint16 n,uint16 p,uint16 k,uint64 nonce,bytes32 payloadHash)")
    expect(READING_TYPEHASH).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("signs and recovers the device address", async () => {
    const device = Wallet.createRandom();
    const signed = await signReading(device, DOMAIN, SAMPLE);
    expect(signed.signer).toBe(device.address);
    expect(recoverReadingSigner(DOMAIN, signed.message, signed.signature)).toBe(device.address);
  });

  it("binds the payload hash and on-chain fields into the message", () => {
    const { message, payloadHash } = messageFromPayload(SAMPLE);
    expect(message.payloadHash).toBe(payloadHash);
    expect(fromBytes32Id(message.deviceId)).toBe("CL-DEV-0001");
    expect(fromBytes32Id(message.fieldId)).toBe("FIELD-A1");
    expect(message.n).toBe(142);
    expect(message.nonce).toBe(1n);
  });

  it("does not recover the device address for an altered message", async () => {
    const device = Wallet.createRandom();
    const signed = await signReading(device, DOMAIN, SAMPLE);
    const altered = { ...signed.message, n: signed.message.n + 1 };
    expect(recoverReadingSigner(DOMAIN, altered, signed.signature)).not.toBe(device.address);
  });

  it("does not verify under another chain or contract (domain separation)", async () => {
    const device = Wallet.createRandom();
    const signed = await signReading(device, DOMAIN, SAMPLE);
    const otherChain = { ...DOMAIN, chainId: 31337n };
    const otherContract = { ...DOMAIN, verifyingContract: LOCAL_DEMO_DOMAIN.verifyingContract };
    expect(recoverReadingSigner(otherChain, signed.message, signed.signature)).not.toBe(device.address);
    expect(recoverReadingSigner(otherContract, signed.message, signed.signature)).not.toBe(device.address);
    expect(readingDigest(otherChain, signed.message)).not.toBe(readingDigest(DOMAIN, signed.message));
  });

  it("formats submitReading arguments", async () => {
    const device = Wallet.createRandom();
    const signed = await signReading(device, DOMAIN, SAMPLE);
    const [deviceId, reading, nonce, signature] = toSubmitArgs(signed);
    expect(deviceId).toBe(toBytes32Id("CL-DEV-0001"));
    expect(reading).toEqual({ timestamp: 1_760_000_000n, n: 142, p: 38, k: 191, payloadHash: signed.payloadHash });
    expect(nonce).toBe(1n);
    expect(signature).toMatch(/^0x[0-9a-f]{130}$/);
  });
});
