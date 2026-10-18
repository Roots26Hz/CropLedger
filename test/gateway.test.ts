/**
 * Integration tests for the gateway (simulator/gateway.ts) and the edge
 * device simulator against a real CropLedger deployment on Hardhat's
 * in-process network.
 */
import { expect } from "chai";
import { AbstractSigner, Wallet, makeError, type Provider, type Signer, type TransactionRequest, type TransactionResponse } from "ethers";
import { network } from "hardhat";
import { EdgeDeviceSimulator } from "../simulator/deviceSimulator.js";
import { Gateway, cropLedgerContract, sendTracked, type SubmissionStage } from "../simulator/gateway.js";
import { firmwareHashFor, toBytes32Id } from "../simulator/ids.js";
import { hashPayload } from "../simulator/payload.js";
import { signReading } from "../simulator/signing.js";

// Like a real RPC node, keep mined-but-reverted transactions instead of
// throwing at send time, so the gateway's "reverted" path is exercised.
const { ethers, networkHelpers } = await network.create({ override: { throwOnTransactionFailures: false } });

/**
 * Mimics a wallet whose provider fails right after broadcasting: it sends the
 * transaction (or pretends to), then throws the error ethers raises when it
 * cannot fetch the transaction back — with the hash attached.
 */
class FlakyWalletSigner extends AbstractSigner {
  constructor(
    private readonly inner: Signer,
    private readonly actuallySend = true,
  ) {
    super(inner.provider);
  }
  getAddress() {
    return this.inner.getAddress();
  }
  connect(provider: Provider | null) {
    return new FlakyWalletSigner(this.inner.connect(provider), this.actuallySend);
  }
  signTransaction(): Promise<string> {
    throw new Error("not used");
  }
  signMessage(): Promise<string> {
    throw new Error("not used");
  }
  signTypedData(): Promise<string> {
    throw new Error("not used");
  }
  async sendTransaction(tx: TransactionRequest): Promise<TransactionResponse> {
    const hash = this.actuallySend ? (await this.inner.sendTransaction(tx)).hash : `0x${"ab".repeat(32)}`;
    const error = makeError("failed to fetch transaction after sending", "NETWORK_ERROR", { event: "test" });
    (error as { info?: Record<string, unknown> }).info = { sendTransactionHash: hash };
    throw error;
  }
}

async function fixture() {
  const [owner, relayer] = await ethers.getSigners();
  const ledger = await ethers.deployContract("CropLedger", [owner.address]);
  const address = await ledger.getAddress();
  const { chainId } = await ethers.provider.getNetwork();
  const domain = { chainId, verifyingContract: address };

  const deviceKey = Wallet.createRandom();
  await ledger.registerDevice(
    toBytes32Id("CL-DEV-0001"),
    deviceKey.address,
    toBytes32Id("FIELD-A1"),
    firmwareHashFor("1.4.2"),
  );
  const chainNowMs = (await networkHelpers.time.latest()) * 1000;
  const simulator = new EdgeDeviceSimulator(
    { deviceId: "CL-DEV-0001", fieldId: "FIELD-A1", firmware: "1.4.2" },
    { seed: 42, clock: () => chainNowMs },
  );
  const gateway = new Gateway(cropLedgerContract(address, relayer), domain);
  return { ledger, domain, deviceKey, simulator, gateway, relayer };
}

describe("Gateway", function () {
  it("submits a simulated, signed reading and reports submitted → confirmed", async function () {
    const { ledger, domain, deviceKey, simulator, gateway } = await networkHelpers.loadFixture(fixture);
    const { payload } = simulator.generate();
    const signed = await signReading(deviceKey, domain, payload);

    const stages: SubmissionStage[] = [];
    const result = await gateway.submit(signed, { onUpdate: (u) => stages.push(u.stage) });

    expect(stages).to.deep.equal(["validating", "preflight", "awaiting-wallet", "submitted", "confirmed"]);
    expect(result.ok).to.equal(true);
    expect(result.txHash).to.match(/^0x[0-9a-f]{64}$/);
    expect(result.blockNumber).to.be.a("number");
    expect(result.gasUsed! > 0n).to.equal(true);
    expect(result.readingIndex).to.equal(0);

    const receipt = await ethers.provider.getTransactionReceipt(result.txHash!);
    expect(receipt!.blockNumber).to.equal(result.blockNumber);
    expect(await ledger.verifyReading(toBytes32Id("CL-DEV-0001"), 0, hashPayload(payload))).to.equal(true);
  });

  it("stops a replay in preflight without broadcasting a transaction", async function () {
    const { domain, deviceKey, simulator, gateway, relayer } = await networkHelpers.loadFixture(fixture);
    const signed = await signReading(deviceKey, domain, simulator.generate().payload);
    expect((await gateway.submit(signed)).ok).to.equal(true);

    const nonceBefore = await ethers.provider.getTransactionCount(relayer.address);
    const replay = await gateway.submit(signed);
    expect(replay.ok).to.equal(false);
    expect(replay.stage).to.equal("rejected-preflight");
    expect(replay.error?.name).to.equal("StaleNonce");
    expect(replay.txHash).to.equal(undefined);
    expect(await ethers.provider.getTransactionCount(relayer.address)).to.equal(nonceBefore);
  });

  it("records an on-chain failure when forced to broadcast a rejected reading", async function () {
    const { ledger, domain, deviceKey, simulator, gateway } = await networkHelpers.loadFixture(fixture);
    await ledger.revokeDevice(toBytes32Id("CL-DEV-0001"));
    const signed = await signReading(deviceKey, domain, simulator.generate().payload);

    const result = await gateway.submit(signed, { forceBroadcast: true });
    expect(result.ok).to.equal(false);
    expect(result.stage).to.equal("reverted");
    expect(result.txHash).to.match(/^0x[0-9a-f]{64}$/);
    // The custom error is recovered by re-simulating the mined call.
    expect(result.error?.name).to.equal("DeviceNotActive");
    const receipt = await ethers.provider.getTransactionReceipt(result.txHash!);
    expect(receipt!.status).to.equal(0);
  });

  it("rejects readings signed for another deployment before sending", async function () {
    const { domain, deviceKey, simulator, gateway } = await networkHelpers.loadFixture(fixture);
    const signed = await signReading(deviceKey, { ...domain, chainId: 80002n }, simulator.generate().payload);
    const result = await gateway.submit(signed);
    expect(result.stage).to.equal("failed");
    expect(result.error?.kind).to.equal("validation");
    expect(result.error?.message).to.match(/different chain or contract/);
  });

  it("rejects a payload whose contents no longer match its signed hash", async function () {
    const { domain, deviceKey, simulator, gateway } = await networkHelpers.loadFixture(fixture);
    const signed = await signReading(deviceKey, domain, simulator.generate().payload);
    const tampered = { ...signed, payload: { ...signed.payload, n: signed.payload.n + 10 } };
    const result = await gateway.submit(tampered);
    expect(result.stage).to.equal("failed");
    expect(result.error?.message).to.match(/does not match/);
  });

  it("passes suggested fees to the wallet", async function () {
    const { domain, deviceKey, simulator, relayer } = await networkHelpers.loadFixture(fixture);
    const signed = await signReading(deviceKey, domain, simulator.generate().payload);
    const tip = ethers.parseUnits("31", "gwei");
    const gateway = new Gateway(cropLedgerContract(domain.verifyingContract, relayer), domain);
    const stages: { stage: SubmissionStage; note?: string }[] = [];
    const result = await gateway.submit(signed, {
      fees: async () => ({ maxPriorityFeePerGas: tip, maxFeePerGas: tip * 3n, source: "test" }),
      onUpdate: (u) => stages.push({ stage: u.stage, note: u.note }),
    });
    expect(result.stage).to.equal("confirmed");
    const mined = await ethers.provider.getTransaction(result.txHash!);
    expect(mined!.maxPriorityFeePerGas).to.equal(tip);
    expect(stages.find((s) => s.stage === "awaiting-wallet")?.note).to.match(/31 gwei \(test\)/);
  });

  it("keeps following a broadcast transaction when the wallet's provider fails afterwards", async function () {
    const { ledger, domain, deviceKey, simulator, relayer } = await networkHelpers.loadFixture(fixture);
    const signed = await signReading(deviceKey, domain, simulator.generate().payload);
    const flaky = new FlakyWalletSigner(relayer);
    const stages: SubmissionStage[] = [];
    const result = await new Gateway(cropLedgerContract(domain.verifyingContract, flaky), domain).submit(signed, {
      receiptProvider: ethers.provider,
      onUpdate: (u) => stages.push(u.stage),
    });
    expect(stages).to.include("submitted");
    expect(result.stage).to.equal("confirmed");
    expect(result.readingIndex).to.equal(0);
    expect(await ledger.getReadingCount(toBytes32Id("CL-DEV-0001"))).to.equal(1n);
  });

  it("reports an unconfirmed transaction instead of a failure when no receipt appears", async function () {
    const { domain, relayer } = await networkHelpers.loadFixture(fixture);
    const contract = cropLedgerContract(domain.verifyingContract, new FlakyWalletSigner(relayer, false));
    const result = await sendTracked(contract, "revokeDevice", [toBytes32Id("CL-DEV-0001")], {
      forceBroadcast: true,
      receiptProvider: ethers.provider,
      receiptTimeoutMs: 300,
    });
    expect(result.stage).to.equal("unconfirmed");
    expect(result.txHash).to.equal(`0x${"ab".repeat(32)}`);
    expect(result.error?.message).to.match(/may still confirm/);
  });

  it("refuses to operate on unsupported chains", function () {
    expect(() => new Gateway(cropLedgerContract(Wallet.createRandom().address, ethers.provider), {
      chainId: 137n,
      verifyingContract: Wallet.createRandom().address,
    })).to.throw(/not supported/);
  });
});
