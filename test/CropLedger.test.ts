/**
 * CropLedger smart-contract test suite (Hardhat 3 + Mocha + ethers).
 *
 * Every signed reading is produced by the SAME TypeScript code the simulator,
 * gateway and dashboard use (simulator/signing.ts and simulator/payload.ts),
 * so these tests also prove that the off-chain signing scheme matches the
 * contract's on-chain verification.
 */
import { readFileSync } from "node:fs";
import { expect } from "chai";
import { anyValue } from "@nomicfoundation/hardhat-ethers-chai-matchers/withArgs";
import { Wallet, ZeroAddress, ZeroHash, type HDNodeWallet } from "ethers";
import { network } from "hardhat";
import { firmwareHashFor, toBytes32Id } from "../simulator/ids.js";
import { hashPayload } from "../simulator/payload.js";
import {
  READING_TYPEHASH,
  READING_TYPES,
  readingDigest,
  signReading,
  toSubmitArgs,
  typedDataDomain,
} from "../simulator/signing.js";
import type { DeploymentDomain, Hex, ReadingMessage, ReadingPayload } from "../simulator/types.js";

const { ethers, networkHelpers } = await network.create();

const DEVICE = "CL-DEV-0001";
const DEVICE_B = "CL-DEV-0002";
const FIELD = "FIELD-A1";
const FIELD_B = "FIELD-B7";
const FIRMWARE = "1.4.2";

const DEVICE_ID = toBytes32Id(DEVICE);
const DEVICE_B_ID = toBytes32Id(DEVICE_B);
const FIELD_ID = toBytes32Id(FIELD);
const FIELD_B_ID = toBytes32Id(FIELD_B);
const FIRMWARE_HASH = firmwareHashFor(FIRMWARE);

/** Collected gas measurements, printed at the end of the run. */
const gasReport: Record<string, bigint> = {};

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

async function deployFixture() {
  const [owner, gateway, outsider] = await ethers.getSigners();
  const ledger = await ethers.deployContract("CropLedger", [owner.address]);
  const verifyingContract = await ledger.getAddress();
  const { chainId } = await ethers.provider.getNetwork();
  const domain: DeploymentDomain = { chainId, verifyingContract };
  // Device keys are NOT funded accounts: devices only sign, gateways pay gas.
  const device = Wallet.createRandom();
  const deviceB = Wallet.createRandom();
  return { ledger, owner, gateway, outsider, domain, device, deviceB };
}

async function registeredFixture() {
  const fixture = await deployFixture();
  const { ledger, device, deviceB } = fixture;
  await ledger.registerDevice(DEVICE_ID, device.address, FIELD_ID, FIRMWARE_HASH);
  await ledger.registerDevice(DEVICE_B_ID, deviceB.address, FIELD_B_ID, FIRMWARE_HASH);
  return fixture;
}

async function makePayload(nonce: number, overrides: Partial<ReadingPayload> = {}): Promise<ReadingPayload> {
  const now = await networkHelpers.time.latest();
  return {
    schema: "cropledger.reading.v1",
    deviceId: DEVICE,
    fieldId: FIELD,
    firmware: FIRMWARE,
    timestamp: now,
    nonce,
    n: 142,
    p: 38,
    k: 191,
    soilMoistureBp: 2345,
    soilTempCentiC: 2410,
    phCenti: 652,
    anomalyScoreMilli: 120,
    anomalyLabel: "normal",
    ...overrides,
  };
}

/** Sign a raw message directly (bypasses payload validation, for edge cases). */
async function signRawMessage(signer: HDNodeWallet, domain: DeploymentDomain, message: ReadingMessage): Promise<Hex> {
  return (await signer.signTypedData(
    typedDataDomain(domain),
    READING_TYPES,
    message as unknown as Record<string, unknown>,
  )) as Hex;
}

async function rawMessage(overrides: Partial<ReadingMessage> = {}): Promise<ReadingMessage> {
  return {
    deviceId: DEVICE_ID,
    fieldId: FIELD_ID,
    timestamp: BigInt(await networkHelpers.time.latest()),
    n: 100,
    p: 40,
    k: 150,
    nonce: 1n,
    payloadHash: ethers.keccak256(ethers.toUtf8Bytes("raw-payload")) as Hex,
    ...overrides,
  };
}

function argsFor(message: ReadingMessage, signature: Hex) {
  return toSubmitArgs({ message, signature });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CropLedger", function () {
  after(function () {
    console.log("\n    Gas used on the Hardhat in-process network (measured):");
    for (const [label, gas] of Object.entries(gasReport)) {
      console.log(`      ${label.padEnd(44)} ${gas.toString()}`);
    }
  });

  describe("deployment", function () {
    it("sets the initial owner", async function () {
      const { ledger, owner } = await networkHelpers.loadFixture(deployFixture);
      expect(await ledger.owner()).to.equal(owner.address);
    });

    it("rejects a zero initial owner", async function () {
      const factory = await ethers.getContractFactory("CropLedger");
      await expect(ethers.deployContract("CropLedger", [ZeroAddress])).to.be.revertedWithCustomError(
        factory,
        "OwnableInvalidOwner",
      );
    });

    it("exposes the EIP-712 domain used by the off-chain signer", async function () {
      const { ledger, domain } = await networkHelpers.loadFixture(deployFixture);
      const eip712 = await ledger.eip712Domain();
      expect(eip712.name).to.equal("CropLedger");
      expect(eip712.version).to.equal("1");
      expect(eip712.chainId).to.equal(domain.chainId);
      expect(eip712.verifyingContract).to.equal(domain.verifyingContract);
    });

    it("uses the same READING_TYPEHASH as simulator/signing.ts", async function () {
      const { ledger } = await networkHelpers.loadFixture(deployFixture);
      expect(await ledger.READING_TYPEHASH()).to.equal(READING_TYPEHASH);
    });

    it("starts with no devices or readings", async function () {
      const { ledger } = await networkHelpers.loadFixture(deployFixture);
      expect(await ledger.getDeviceCount()).to.equal(0n);
      expect(await ledger.totalReadings()).to.equal(0n);
      expect(await ledger.getReadingCount(DEVICE_ID)).to.equal(0n);
    });

    it("ships an ABI file identical to the compiled artifact", async function () {
      const artifact = JSON.parse(
        readFileSync(new URL("../artifacts/contracts/CropLedger.sol/CropLedger.json", import.meta.url), "utf8"),
      ) as { abi: unknown };
      const committed = JSON.parse(readFileSync(new URL("../abi/CropLedger.json", import.meta.url), "utf8")) as unknown;
      expect(committed, "abi/CropLedger.json is stale: run `npm run export-abi`").to.deep.equal(artifact.abi);
    });
  });

  describe("device registration", function () {
    it("registers a device and emits DeviceRegistered", async function () {
      const { ledger, device } = await networkHelpers.loadFixture(deployFixture);
      const tx = ledger.registerDevice(DEVICE_ID, device.address, FIELD_ID, FIRMWARE_HASH);
      await expect(tx)
        .to.emit(ledger, "DeviceRegistered")
        .withArgs(DEVICE_ID, FIELD_ID, device.address, FIRMWARE_HASH);
      gasReport["registerDevice"] = (await (await tx).wait())!.gasUsed;

      const stored = await ledger.getDevice(DEVICE_ID);
      expect(stored.signer).to.equal(device.address);
      expect(stored.fieldId).to.equal(FIELD_ID);
      expect(stored.firmwareHash).to.equal(FIRMWARE_HASH);
      expect(stored.active).to.equal(true);
      expect(stored.lastNonce).to.equal(0n);
      expect(stored.registeredAt).to.equal(BigInt(await networkHelpers.time.latest()));
      expect(stored.revokedAt).to.equal(0n);
      expect(await ledger.isDeviceActive(DEVICE_ID)).to.equal(true);
      expect(await ledger.deviceIdOfSigner(device.address)).to.equal(DEVICE_ID);
    });

    it("enumerates registered devices", async function () {
      const { ledger } = await networkHelpers.loadFixture(registeredFixture);
      expect(await ledger.getDeviceCount()).to.equal(2n);
      expect(await ledger.deviceIdAt(0)).to.equal(DEVICE_ID);
      expect(await ledger.deviceIdAt(1)).to.equal(DEVICE_B_ID);
      await expect(ledger.deviceIdAt(2))
        .to.be.revertedWithCustomError(ledger, "DeviceIndexOutOfBounds")
        .withArgs(2n, 2n);
    });

    it("rejects a duplicate device ID", async function () {
      const { ledger } = await networkHelpers.loadFixture(registeredFixture);
      await expect(ledger.registerDevice(DEVICE_ID, Wallet.createRandom().address, FIELD_ID, FIRMWARE_HASH))
        .to.be.revertedWithCustomError(ledger, "DeviceAlreadyRegistered")
        .withArgs(DEVICE_ID);
    });

    it("rejects a signing key already assigned to another device", async function () {
      const { ledger, device } = await networkHelpers.loadFixture(registeredFixture);
      const otherId = toBytes32Id("CL-DEV-0099");
      await expect(ledger.registerDevice(otherId, device.address, FIELD_ID, FIRMWARE_HASH))
        .to.be.revertedWithCustomError(ledger, "SignerAlreadyAssigned")
        .withArgs(device.address, DEVICE_ID);
    });

    it("rejects registration by a non-owner", async function () {
      const { ledger, outsider, device } = await networkHelpers.loadFixture(deployFixture);
      await expect(ledger.connect(outsider).registerDevice(DEVICE_ID, device.address, FIELD_ID, FIRMWARE_HASH))
        .to.be.revertedWithCustomError(ledger, "OwnableUnauthorizedAccount")
        .withArgs(outsider.address);
    });

    it("validates registration inputs", async function () {
      const { ledger, device } = await networkHelpers.loadFixture(deployFixture);
      await expect(
        ledger.registerDevice(ZeroHash, device.address, FIELD_ID, FIRMWARE_HASH),
      ).to.be.revertedWithCustomError(ledger, "InvalidDeviceId");
      await expect(
        ledger.registerDevice(DEVICE_ID, ZeroAddress, FIELD_ID, FIRMWARE_HASH),
      ).to.be.revertedWithCustomError(ledger, "InvalidSigner");
      await expect(
        ledger.registerDevice(DEVICE_ID, device.address, ZeroHash, FIRMWARE_HASH),
      ).to.be.revertedWithCustomError(ledger, "InvalidFieldId");
      await expect(
        ledger.registerDevice(DEVICE_ID, device.address, FIELD_ID, ZeroHash),
      ).to.be.revertedWithCustomError(ledger, "InvalidFirmwareHash");
    });

    it("reverts getDevice for an unknown device", async function () {
      const { ledger } = await networkHelpers.loadFixture(deployFixture);
      await expect(ledger.getDevice(DEVICE_ID))
        .to.be.revertedWithCustomError(ledger, "UnknownDevice")
        .withArgs(DEVICE_ID);
      expect(await ledger.isDeviceActive(DEVICE_ID)).to.equal(false);
    });
  });

  describe("device revocation", function () {
    it("revokes a device and emits DeviceRevoked", async function () {
      const { ledger } = await networkHelpers.loadFixture(registeredFixture);
      await expect(ledger.revokeDevice(DEVICE_ID)).to.emit(ledger, "DeviceRevoked").withArgs(DEVICE_ID, anyValue);
      const stored = await ledger.getDevice(DEVICE_ID);
      expect(stored.active).to.equal(false);
      expect(stored.revokedAt).to.equal(BigInt(await networkHelpers.time.latest()));
      expect(await ledger.isDeviceActive(DEVICE_ID)).to.equal(false);
    });

    it("rejects revocation by a non-owner", async function () {
      const { ledger, outsider } = await networkHelpers.loadFixture(registeredFixture);
      await expect(ledger.connect(outsider).revokeDevice(DEVICE_ID))
        .to.be.revertedWithCustomError(ledger, "OwnableUnauthorizedAccount")
        .withArgs(outsider.address);
    });

    it("rejects revoking an unknown or already revoked device", async function () {
      const { ledger } = await networkHelpers.loadFixture(registeredFixture);
      const unknown = toBytes32Id("CL-DEV-404");
      await expect(ledger.revokeDevice(unknown)).to.be.revertedWithCustomError(ledger, "UnknownDevice").withArgs(unknown);
      await ledger.revokeDevice(DEVICE_ID);
      await expect(ledger.revokeDevice(DEVICE_ID))
        .to.be.revertedWithCustomError(ledger, "DeviceNotActive")
        .withArgs(DEVICE_ID);
    });

    it("never allows a revoked device ID to be registered again", async function () {
      const { ledger } = await networkHelpers.loadFixture(registeredFixture);
      await ledger.revokeDevice(DEVICE_ID);
      await expect(ledger.registerDevice(DEVICE_ID, Wallet.createRandom().address, FIELD_ID, FIRMWARE_HASH))
        .to.be.revertedWithCustomError(ledger, "DeviceAlreadyRegistered")
        .withArgs(DEVICE_ID);
    });
  });

  describe("firmware hash updates", function () {
    it("lets the owner record a new firmware hash", async function () {
      const { ledger } = await networkHelpers.loadFixture(registeredFixture);
      const next = firmwareHashFor("1.5.0");
      await expect(ledger.updateFirmwareHash(DEVICE_ID, next))
        .to.emit(ledger, "FirmwareHashUpdated")
        .withArgs(DEVICE_ID, FIRMWARE_HASH, next);
      expect((await ledger.getDevice(DEVICE_ID)).firmwareHash).to.equal(next);
    });

    it("rejects non-owners, zero hashes and revoked devices", async function () {
      const { ledger, outsider } = await networkHelpers.loadFixture(registeredFixture);
      const next = firmwareHashFor("1.5.0");
      await expect(ledger.connect(outsider).updateFirmwareHash(DEVICE_ID, next)).to.be.revertedWithCustomError(
        ledger,
        "OwnableUnauthorizedAccount",
      );
      await expect(ledger.updateFirmwareHash(DEVICE_ID, ZeroHash)).to.be.revertedWithCustomError(
        ledger,
        "InvalidFirmwareHash",
      );
      await ledger.revokeDevice(DEVICE_ID);
      await expect(ledger.updateFirmwareHash(DEVICE_ID, next)).to.be.revertedWithCustomError(ledger, "DeviceNotActive");
    });
  });

  describe("reading submission", function () {
    it("accepts a device-signed reading relayed by any gateway", async function () {
      const { ledger, gateway, device, domain } = await networkHelpers.loadFixture(registeredFixture);
      const signed = await signReading(device, domain, await makePayload(1));

      const tx = ledger.connect(gateway).submitReading(...toSubmitArgs(signed));
      await expect(tx)
        .to.emit(ledger, "ReadingRecorded")
        .withArgs(
          DEVICE_ID,
          FIELD_ID,
          0n,
          1n,
          signed.message.timestamp,
          142n,
          38n,
          191n,
          signed.payloadHash,
          gateway.address,
        );
      const receipt = (await (await tx).wait())!;
      gasReport["submitReading (first reading of a device)"] = receipt.gasUsed;

      expect(await ledger.getReadingCount(DEVICE_ID)).to.equal(1n);
      expect(await ledger.totalReadings()).to.equal(1n);
      expect((await ledger.getDevice(DEVICE_ID)).lastNonce).to.equal(1n);

      const stored = await ledger.getReading(DEVICE_ID, 0);
      expect(stored.timestamp).to.equal(signed.message.timestamp);
      expect(stored.n).to.equal(142n);
      expect(stored.p).to.equal(38n);
      expect(stored.k).to.equal(191n);
      expect(stored.nonce).to.equal(1n);
      expect(stored.blockNumber).to.equal(BigInt(receipt.blockNumber));
      expect(stored.payloadHash).to.equal(signed.payloadHash);
    });

    it("returns sequential indices and keeps per-device histories separate", async function () {
      const { ledger, gateway, device, deviceB, domain } = await networkHelpers.loadFixture(registeredFixture);
      const r1 = await signReading(device, domain, await makePayload(1));
      const r2 = await signReading(device, domain, await makePayload(2, { n: 150 }));
      const b1 = await signReading(deviceB, domain, await makePayload(1, { deviceId: DEVICE_B, fieldId: FIELD_B }));

      expect(await ledger.connect(gateway).submitReading.staticCall(...toSubmitArgs(r1))).to.equal(0n);
      await ledger.connect(gateway).submitReading(...toSubmitArgs(r1));
      const tx = await ledger.connect(gateway).submitReading(...toSubmitArgs(r2));
      gasReport["submitReading (subsequent reading)"] = (await tx.wait())!.gasUsed;
      await expect(ledger.connect(gateway).submitReading(...toSubmitArgs(b1)))
        .to.emit(ledger, "ReadingRecorded")
        .withArgs(DEVICE_B_ID, FIELD_B_ID, 0n, 1n, anyValue, anyValue, anyValue, anyValue, b1.payloadHash, gateway.address);

      expect(await ledger.getReadingCount(DEVICE_ID)).to.equal(2n);
      expect(await ledger.getReadingCount(DEVICE_B_ID)).to.equal(1n);
      expect(await ledger.totalReadings()).to.equal(3n);
      expect((await ledger.getReading(DEVICE_ID, 1)).n).to.equal(150n);
    });

    it("computes the same EIP-712 digest as the TypeScript signer", async function () {
      const { ledger, device, domain } = await networkHelpers.loadFixture(registeredFixture);
      const signed = await signReading(device, domain, await makePayload(7));
      const [deviceId, reading, nonce] = toSubmitArgs(signed);
      expect(await ledger.readingDigest(deviceId, FIELD_ID, reading, nonce)).to.equal(
        readingDigest(domain, signed.message),
      );
    });

    it("rejects out-of-range reading lookups", async function () {
      const { ledger } = await networkHelpers.loadFixture(registeredFixture);
      await expect(ledger.getReading(DEVICE_ID, 0))
        .to.be.revertedWithCustomError(ledger, "ReadingIndexOutOfBounds")
        .withArgs(DEVICE_ID, 0n, 0n);
    });
  });

  describe("payload integrity verification", function () {
    it("verifies the genuine payload and rejects a tampered copy", async function () {
      const { ledger, gateway, device, domain } = await networkHelpers.loadFixture(registeredFixture);
      const payload = await makePayload(1);
      const signed = await signReading(device, domain, payload);
      await ledger.connect(gateway).submitReading(...toSubmitArgs(signed));

      // Genuine: recomputing the hash of the stored off-chain payload matches.
      expect(await ledger.verifyReading(DEVICE_ID, 0, hashPayload(payload))).to.equal(true);

      // Tampered: change a single nutrient value in the off-chain record.
      const tampered = { ...payload, n: payload.n + 25 };
      expect(await ledger.verifyReading(DEVICE_ID, 0, hashPayload(tampered))).to.equal(false);

      // Tampering with off-chain-only metadata is detected too.
      const tamperedMeta = { ...payload, soilMoistureBp: payload.soilMoistureBp + 1 };
      expect(await ledger.verifyReading(DEVICE_ID, 0, hashPayload(tamperedMeta))).to.equal(false);
    });

    it("rejects verification of a reading that does not exist", async function () {
      const { ledger } = await networkHelpers.loadFixture(registeredFixture);
      await expect(ledger.verifyReading(DEVICE_ID, 3, ZeroHash))
        .to.be.revertedWithCustomError(ledger, "ReadingIndexOutOfBounds")
        .withArgs(DEVICE_ID, 3n, 0n);
    });
  });

  describe("signature checks", function () {
    it("rejects a reading signed by an unregistered key", async function () {
      const { ledger, gateway, domain } = await networkHelpers.loadFixture(registeredFixture);
      const impostor = Wallet.createRandom();
      const signed = await signReading(impostor, domain, await makePayload(1));
      await expect(ledger.connect(gateway).submitReading(...toSubmitArgs(signed)))
        .to.be.revertedWithCustomError(ledger, "InvalidSignature")
        .withArgs(DEVICE_ID);
    });

    it("rejects values altered by the gateway after signing", async function () {
      const { ledger, gateway, device, domain } = await networkHelpers.loadFixture(registeredFixture);
      const signed = await signReading(device, domain, await makePayload(1));
      const [deviceId, reading, nonce, signature] = toSubmitArgs(signed);

      await expect(
        ledger.connect(gateway).submitReading(deviceId, { ...reading, n: reading.n + 50 }, nonce, signature),
      ).to.be.revertedWithCustomError(ledger, "InvalidSignature");
      await expect(
        ledger.connect(gateway).submitReading(deviceId, { ...reading, payloadHash: ZeroHash.replace(/0$/, "1") as Hex }, nonce, signature),
      ).to.be.revertedWithCustomError(ledger, "InvalidSignature");
      await expect(
        ledger.connect(gateway).submitReading(deviceId, { ...reading, timestamp: reading.timestamp - 60n }, nonce, signature),
      ).to.be.revertedWithCustomError(ledger, "InvalidSignature");
    });

    it("rejects a device's signature submitted under another device ID", async function () {
      const { ledger, gateway, device, domain } = await networkHelpers.loadFixture(registeredFixture);
      const signed = await signReading(device, domain, await makePayload(1));
      const [, reading, nonce, signature] = toSubmitArgs(signed);
      await expect(ledger.connect(gateway).submitReading(DEVICE_B_ID, reading, nonce, signature))
        .to.be.revertedWithCustomError(ledger, "InvalidSignature")
        .withArgs(DEVICE_B_ID);
    });

    it("rejects a reading signed for a different field", async function () {
      const { ledger, gateway, device, domain } = await networkHelpers.loadFixture(registeredFixture);
      const signed = await signReading(device, domain, await makePayload(1, { fieldId: FIELD_B }));
      await expect(ledger.connect(gateway).submitReading(...toSubmitArgs(signed))).to.be.revertedWithCustomError(
        ledger,
        "InvalidSignature",
      );
    });

    it("rejects signatures made for another deployment or chain", async function () {
      const { ledger, owner, gateway, device, domain } = await networkHelpers.loadFixture(registeredFixture);
      const payload = await makePayload(1);

      const otherLedger = await ethers.deployContract("CropLedger", [owner.address]);
      const otherDomain = { ...domain, verifyingContract: await otherLedger.getAddress() };
      const forOtherContract = await signReading(device, otherDomain, payload);
      await expect(ledger.connect(gateway).submitReading(...toSubmitArgs(forOtherContract))).to.be.revertedWithCustomError(
        ledger,
        "InvalidSignature",
      );

      const forOtherChain = await signReading(device, { ...domain, chainId: 80002n }, payload);
      await expect(ledger.connect(gateway).submitReading(...toSubmitArgs(forOtherChain))).to.be.revertedWithCustomError(
        ledger,
        "InvalidSignature",
      );
    });

    it("rejects malformed signatures", async function () {
      const { ledger, gateway, device, domain } = await networkHelpers.loadFixture(registeredFixture);
      const signed = await signReading(device, domain, await makePayload(1));
      const [deviceId, reading, nonce] = toSubmitArgs(signed);
      for (const bad of ["0x", `0x${"11".repeat(64)}`, `0x${"00".repeat(65)}`]) {
        await expect(ledger.connect(gateway).submitReading(deviceId, reading, nonce, bad)).to.be.revertedWithCustomError(
          ledger,
          "InvalidSignature",
        );
      }
    });
  });

  describe("unregistered and revoked devices", function () {
    it("rejects readings from an unregistered device", async function () {
      const { ledger, gateway, domain } = await networkHelpers.loadFixture(registeredFixture);
      const rogue = Wallet.createRandom();
      const rogueId = toBytes32Id("ROGUE-01");
      const signed = await signReading(rogue, domain, await makePayload(1, { deviceId: "ROGUE-01" }));
      await expect(ledger.connect(gateway).submitReading(...toSubmitArgs(signed)))
        .to.be.revertedWithCustomError(ledger, "UnknownDevice")
        .withArgs(rogueId);
    });

    it("rejects new readings after revocation but keeps the history", async function () {
      const { ledger, gateway, device, domain } = await networkHelpers.loadFixture(registeredFixture);
      const payload1 = await makePayload(1);
      await ledger.connect(gateway).submitReading(...toSubmitArgs(await signReading(device, domain, payload1)));

      await ledger.revokeDevice(DEVICE_ID);

      const signed2 = await signReading(device, domain, await makePayload(2));
      await expect(ledger.connect(gateway).submitReading(...toSubmitArgs(signed2)))
        .to.be.revertedWithCustomError(ledger, "DeviceNotActive")
        .withArgs(DEVICE_ID);

      expect(await ledger.getReadingCount(DEVICE_ID)).to.equal(1n);
      expect((await ledger.getReading(DEVICE_ID, 0)).nonce).to.equal(1n);
      expect(await ledger.verifyReading(DEVICE_ID, 0, hashPayload(payload1))).to.equal(true);
    });
  });

  describe("replay protection", function () {
    it("rejects the same signed reading submitted twice", async function () {
      const { ledger, gateway, outsider, device, domain } = await networkHelpers.loadFixture(registeredFixture);
      const signed = await signReading(device, domain, await makePayload(1));
      await ledger.connect(gateway).submitReading(...toSubmitArgs(signed));
      // Even a different relayer cannot replay it.
      await expect(ledger.connect(outsider).submitReading(...toSubmitArgs(signed)))
        .to.be.revertedWithCustomError(ledger, "StaleNonce")
        .withArgs(DEVICE_ID, 1n, 1n);
      expect(await ledger.getReadingCount(DEVICE_ID)).to.equal(1n);
    });

    it("rejects an older nonce after a newer one", async function () {
      const { ledger, gateway, device, domain } = await networkHelpers.loadFixture(registeredFixture);
      const older = await signReading(device, domain, await makePayload(3));
      const newer = await signReading(device, domain, await makePayload(5));
      await ledger.connect(gateway).submitReading(...toSubmitArgs(newer));
      await expect(ledger.connect(gateway).submitReading(...toSubmitArgs(older)))
        .to.be.revertedWithCustomError(ledger, "StaleNonce")
        .withArgs(DEVICE_ID, 3n, 5n);
    });

    it("allows gaps in the nonce sequence (e.g. readings lost in transit)", async function () {
      const { ledger, gateway, device, domain } = await networkHelpers.loadFixture(registeredFixture);
      await ledger.connect(gateway).submitReading(...toSubmitArgs(await signReading(device, domain, await makePayload(1))));
      await ledger.connect(gateway).submitReading(...toSubmitArgs(await signReading(device, domain, await makePayload(9))));
      expect((await ledger.getDevice(DEVICE_ID)).lastNonce).to.equal(9n);
    });

    it("rejects a zero nonce", async function () {
      const { ledger, gateway, device, domain } = await networkHelpers.loadFixture(registeredFixture);
      const message = await rawMessage({ nonce: 0n });
      const signature = await signRawMessage(device, domain, message);
      await expect(ledger.connect(gateway).submitReading(...argsFor(message, signature)))
        .to.be.revertedWithCustomError(ledger, "StaleNonce")
        .withArgs(DEVICE_ID, 0n, 0n);
    });
  });

  describe("reading input validation", function () {
    it("rejects a zero timestamp", async function () {
      const { ledger, gateway, device, domain } = await networkHelpers.loadFixture(registeredFixture);
      const message = await rawMessage({ timestamp: 0n });
      const signature = await signRawMessage(device, domain, message);
      await expect(ledger.connect(gateway).submitReading(...argsFor(message, signature)))
        .to.be.revertedWithCustomError(ledger, "InvalidTimestamp")
        .withArgs(0n);
    });

    it("rejects timestamps too far in the future but tolerates small clock drift", async function () {
      const { ledger, gateway, device, domain } = await networkHelpers.loadFixture(registeredFixture);
      const now = BigInt(await networkHelpers.time.latest());

      const future = await rawMessage({ timestamp: now + 15n * 60n + 30n });
      await expect(
        ledger.connect(gateway).submitReading(...argsFor(future, await signRawMessage(device, domain, future))),
      ).to.be.revertedWithCustomError(ledger, "InvalidTimestamp");

      const slightlyAhead = await rawMessage({ timestamp: now + 60n });
      await expect(
        ledger.connect(gateway).submitReading(...argsFor(slightlyAhead, await signRawMessage(device, domain, slightlyAhead))),
      ).to.emit(ledger, "ReadingRecorded");
    });

    it("rejects nutrient values above the sanity bound", async function () {
      const { ledger, gateway, device, domain } = await networkHelpers.loadFixture(registeredFixture);
      const message = await rawMessage({ k: 10_001 });
      await expect(ledger.connect(gateway).submitReading(...argsFor(message, await signRawMessage(device, domain, message))))
        .to.be.revertedWithCustomError(ledger, "NutrientValueOutOfRange")
        .withArgs(100n, 40n, 10_001n);
    });

    it("rejects an empty payload hash", async function () {
      const { ledger, gateway, device, domain } = await networkHelpers.loadFixture(registeredFixture);
      const message = await rawMessage({ payloadHash: ZeroHash as Hex });
      await expect(
        ledger.connect(gateway).submitReading(...argsFor(message, await signRawMessage(device, domain, message))),
      ).to.be.revertedWithCustomError(ledger, "InvalidPayloadHash");
    });
  });

  describe("ownership", function () {
    it("transfers ownership in two steps", async function () {
      const { ledger, owner, outsider, deviceB } = await networkHelpers.loadFixture(deployFixture);
      await ledger.transferOwnership(outsider.address);
      expect(await ledger.owner()).to.equal(owner.address);
      expect(await ledger.pendingOwner()).to.equal(outsider.address);
      await ledger.connect(outsider).acceptOwnership();
      expect(await ledger.owner()).to.equal(outsider.address);
      await expect(
        ledger.connect(outsider).registerDevice(DEVICE_B_ID, deviceB.address, FIELD_B_ID, FIRMWARE_HASH),
      ).to.emit(ledger, "DeviceRegistered");
      await expect(ledger.connect(owner).revokeDevice(DEVICE_B_ID)).to.be.revertedWithCustomError(
        ledger,
        "OwnableUnauthorizedAccount",
      );
    });
  });
});
