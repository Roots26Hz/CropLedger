/**
 * Gateway / relay: receives device-signed readings and submits them to the
 * CropLedger contract through any ethers Signer (MetaMask in the browser, an
 * environment-configured testnet key in the Node CLI).
 *
 * Lifecycle reported through onUpdate:
 *   validating → preflight → awaiting-wallet → submitted (tx hash known)
 *             → confirmed (receipt received, block number + gas known)
 * or one of: rejected-preflight | wallet-rejected | reverted | failed.
 *
 * "submitted" means the transaction was accepted by the RPC node into the
 * mempool. It is only reported as "confirmed" after a receipt with
 * status 1 is available.
 */
import { Contract, getAddress, type ContractRunner, type ContractTransactionResponse } from "ethers";
import { CROPLEDGER_ABI } from "./abi.js";
import { decodeError, type DecodedError } from "./errors.js";
import { assertSupportedChain } from "./networks.js";
import { canonicalize, hashCanonicalJson, validatePayload } from "./payload.js";
import { messageFromPayload, recoverReadingSigner, toSubmitArgs } from "./signing.js";
import type { DeploymentDomain, Hex, SignedReading } from "./types.js";

export type SubmissionStage =
  | "validating"
  | "preflight"
  | "awaiting-wallet"
  | "submitted"
  | "confirmed"
  | "rejected-preflight"
  | "wallet-rejected"
  | "reverted"
  | "failed";

export interface SubmissionUpdate {
  stage: SubmissionStage;
  at: number;
  txHash?: Hex;
  blockNumber?: number;
  gasUsed?: bigint;
  readingIndex?: number;
  error?: DecodedError;
}

export interface SubmissionResult extends SubmissionUpdate {
  ok: boolean;
}

export interface SubmitOptions {
  /** Skip the eth_call preflight and broadcast anyway (to record an on-chain failure). */
  forceBroadcast?: boolean;
  /** Gas limit used when forceBroadcast is set (estimation would fail). */
  forcedGasLimit?: bigint;
  /** Number of confirmations to wait for (default 1). */
  confirmations?: number;
  onUpdate?: (update: SubmissionUpdate) => void;
}

/** Thrown when a signed reading fails the gateway's structural checks. */
export class GatewayValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayValidationError";
  }
}

/**
 * Structural validation before anything is sent. The contract enforces all
 * security rules on-chain; these checks only catch malformed input early.
 */
export function validateSignedReading(signed: SignedReading, domain: DeploymentDomain): void {
  const payload = validatePayload(signed.payload);
  const canonicalJson = canonicalize(payload);
  if (canonicalJson !== signed.canonicalJson) {
    throw new GatewayValidationError("Canonical JSON does not match the payload.");
  }
  const payloadHash = hashCanonicalJson(canonicalJson);
  if (payloadHash !== signed.payloadHash || payloadHash !== signed.message.payloadHash) {
    throw new GatewayValidationError("Payload hash does not match the payload contents.");
  }
  const { message } = messageFromPayload(payload);
  if (
    message.deviceId !== signed.message.deviceId ||
    message.fieldId !== signed.message.fieldId ||
    message.timestamp !== signed.message.timestamp ||
    message.nonce !== signed.message.nonce ||
    message.n !== signed.message.n ||
    message.p !== signed.message.p ||
    message.k !== signed.message.k
  ) {
    throw new GatewayValidationError("Signed message does not match the payload values.");
  }
  if (
    signed.domain.chainId !== domain.chainId ||
    getAddress(signed.domain.verifyingContract) !== getAddress(domain.verifyingContract)
  ) {
    throw new GatewayValidationError(
      "Reading was signed for a different chain or contract. Re-sign it for the configured deployment.",
    );
  }
  if (!/^0x[0-9a-fA-F]{130}$/.test(signed.signature)) {
    throw new GatewayValidationError("Signature must be 65 bytes of hex.");
  }
  const recovered = recoverReadingSigner(domain, signed.message, signed.signature);
  if (recovered !== signed.signer) {
    throw new GatewayValidationError("Signature does not recover to the reported device signer.");
  }
}

export function cropLedgerContract(address: string, runner: ContractRunner): Contract {
  return new Contract(address, CROPLEDGER_ABI, runner);
}

export class Gateway {
  readonly contract: Contract;
  readonly domain: DeploymentDomain;

  /**
   * @param contract CropLedger contract connected to a Signer that pays gas.
   * @param domain   Chain ID + contract address the device signed for.
   */
  constructor(contract: Contract, domain: DeploymentDomain) {
    assertSupportedChain(domain.chainId);
    this.contract = contract;
    this.domain = domain;
  }

  /** Validate, preflight, broadcast and confirm one signed reading. */
  async submit(signed: SignedReading, options: SubmitOptions = {}): Promise<SubmissionResult> {
    options.onUpdate?.({ stage: "validating", at: Date.now() });
    try {
      validateSignedReading(signed, this.domain);
    } catch (error) {
      const result: SubmissionResult = {
        ok: false,
        stage: "failed",
        at: Date.now(),
        error: { kind: "validation", message: (error as Error).message },
      };
      options.onUpdate?.(result);
      return result;
    }
    return sendTracked(this.contract, "submitReading", toSubmitArgs(signed), options);
  }
}

/**
 * Preflight, broadcast and confirm any CropLedger write, reporting each
 * lifecycle stage. Used for readings (via Gateway) and for registry actions.
 */
export async function sendTracked(
  contract: Contract,
  functionName: string,
  args: readonly unknown[],
  options: SubmitOptions = {},
): Promise<SubmissionResult> {
  const emit = (update: Omit<SubmissionUpdate, "at">) => {
    const full = { ...update, at: Date.now() };
    options.onUpdate?.(full);
    return full;
  };
  const finish = (update: Omit<SubmissionUpdate, "at">, ok: boolean): SubmissionResult => ({ ...emit(update), ok });
  const fn = contract.getFunction(functionName);

  // Preflight: simulate the call so contract rejections are reported
  // before the user is asked to pay gas.
  if (!options.forceBroadcast) {
    emit({ stage: "preflight" });
    try {
      await fn.staticCall(...args);
    } catch (error) {
      const decoded = decodeError(error);
      return finish({ stage: decoded.kind === "contract" ? "rejected-preflight" : "failed", error: decoded }, false);
    }
  }

  emit({ stage: "awaiting-wallet" });
  let tx: ContractTransactionResponse;
  try {
    tx = (await fn(...args, options.forceBroadcast ? { gasLimit: options.forcedGasLimit ?? 300_000n } : {})) as ContractTransactionResponse;
  } catch (error) {
    const decoded = decodeError(error);
    // Without forceBroadcast the wallet's own gas estimation can surface a
    // contract rejection here; with it, the node refused to broadcast.
    const stage: SubmissionStage =
      decoded.kind === "wallet-rejected"
        ? "wallet-rejected"
        : decoded.kind === "contract" && !options.forceBroadcast
          ? "rejected-preflight"
          : "failed";
    return finish({ stage, error: decoded }, false);
  }

  const txHash = tx.hash as Hex;
  emit({ stage: "submitted", txHash });

  try {
    const receipt = await tx.wait(options.confirmations ?? 1);
    if (!receipt || receipt.status !== 1) {
      const reason = await recoverRevertReason(contract, tx, receipt?.blockNumber);
      return finish(
        {
          stage: "reverted",
          txHash,
          blockNumber: receipt?.blockNumber,
          gasUsed: receipt?.gasUsed,
          error: reason
            ? { ...reason, message: `Mined but reverted (gas was spent). ${reason.message}` }
            : { kind: "contract", message: "The transaction was mined but reverted." },
        },
        false,
      );
    }
    let readingIndex: number | undefined;
    for (const log of receipt.logs) {
      try {
        const parsed = contract.interface.parseLog(log);
        if (parsed?.name === "ReadingRecorded") readingIndex = Number(parsed.args.getValue("index"));
      } catch {
        // Not a CropLedger event.
      }
    }
    return finish({ stage: "confirmed", txHash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed, readingIndex }, true);
  } catch (error) {
    // ethers throws CALL_EXCEPTION for receipts with status 0.
    const receipt = (error as { receipt?: { blockNumber?: number; gasUsed?: bigint } }).receipt;
    const decoded = (receipt ? await recoverRevertReason(contract, tx, receipt.blockNumber) : null) ?? decodeError(error);
    return finish(
      {
        stage: receipt ? "reverted" : "failed",
        txHash,
        blockNumber: receipt?.blockNumber,
        gasUsed: receipt?.gasUsed,
        error: receipt ? { ...decoded, message: `Mined but reverted (gas was spent). ${decoded.message}` } : decoded,
      },
      false,
    );
  }
}

/**
 * Receipts do not carry revert data, so after a mined-but-reverted
 * transaction we replay the same call with eth_call on the state just before
 * its block to recover the contract's custom error. Best effort: returns null
 * if no CropLedger error can be decoded.
 */
async function recoverRevertReason(
  contract: Contract,
  tx: ContractTransactionResponse,
  blockNumber: number | undefined,
): Promise<DecodedError | null> {
  const provider = contract.runner?.provider;
  if (!provider) return null;
  try {
    await provider.call({
      to: tx.to,
      from: tx.from,
      data: tx.data,
      value: tx.value,
      blockTag: blockNumber !== undefined && blockNumber > 0 ? blockNumber - 1 : "latest",
    });
    return null;
  } catch (error) {
    const decoded = decodeError(error);
    return decoded.kind === "contract" && decoded.name ? decoded : null;
  }
}
