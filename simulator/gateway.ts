/**
 * Gateway / relay: receives device-signed readings and submits them to the
 * CropLedger contract through any ethers Signer (MetaMask in the browser, an
 * environment-configured testnet key in the Node CLI).
 *
 * Lifecycle reported through onUpdate:
 *   validating → preflight → awaiting-wallet → submitted (tx hash known)
 *             → confirmed (receipt received, block number + gas known)
 * or one of: rejected-preflight | wallet-rejected | reverted | failed |
 * unconfirmed (broadcast, but no receipt seen yet — it may still confirm).
 *
 * "submitted" means the transaction was accepted by the RPC node into the
 * mempool. It is only reported as "confirmed" after a receipt with
 * status 1 is available.
 */
import {
  Contract,
  formatEther,
  getAddress,
  type ContractRunner,
  type ContractTransactionResponse,
  type TransactionReceipt,
} from "ethers";
import { CROPLEDGER_ABI } from "./abi.js";
import { decodeError, type DecodedError } from "./errors.js";
import { formatGwei, type FeeOverrides } from "./fees.js";
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
  | "failed"
  | "unconfirmed";

export interface SubmissionUpdate {
  stage: SubmissionStage;
  at: number;
  txHash?: Hex;
  blockNumber?: number;
  gasUsed?: bigint;
  readingIndex?: number;
  error?: DecodedError;
  /** Extra detail for the lifecycle view (e.g. the fee that was suggested). */
  note?: string;
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
  /**
   * Explicit EIP-1559 fees to propose to the wallet (e.g. Polygon's minimum
   * priority fee). Undefined → the wallet chooses.
   */
  fees?: () => Promise<FeeOverrides | undefined>;
  /**
   * Provider used to follow a transaction by hash when the wallet's own
   * provider fails after broadcasting (e.g. the dashboard's read RPC).
   */
  receiptProvider?: ContractRunner["provider"];
  /** How long to wait for a receipt when following by hash (default 3 min). */
  receiptTimeoutMs?: number;
  /**
   * Independent read provider for the preflight, the gas estimate and a
   * balance check, all done before the wallet is asked to sign. The wallet
   * then receives an explicit gas limit. Without it, the signer's own
   * provider is used (e.g. in tests and on the CLI's local node).
   */
  callProvider?: ContractRunner["provider"];
  /** Native token symbol for balance messages (default "ETH"). */
  currencySymbol?: string;
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
  const rejected = (error: unknown) => {
    const decoded = decodeError(error);
    return finish({ stage: decoded.kind === "contract" ? "rejected-preflight" : "failed", error: decoded }, false);
  };

  // With an independent read provider, simulate and estimate from the
  // sender's address there instead of through the wallet.
  const reader = options.callProvider ?? undefined;
  const sender = reader ? await (contract.runner as { getAddress?: () => Promise<string> } | null)?.getAddress?.() : undefined;
  const call = reader && sender ? { to: await contract.getAddress(), from: sender, data: contract.interface.encodeFunctionData(functionName, args) } : undefined;

  // Preflight: simulate the call so contract rejections are reported
  // before the user is asked to pay gas.
  if (!options.forceBroadcast) {
    emit({ stage: "preflight" });
    try {
      if (reader && call) await reader.call(call);
      else await fn.staticCall(...args);
    } catch (error) {
      return rejected(error);
    }
  }

  // Propose fees the network will accept (the wallet may still adjust them).
  const overrides: Record<string, unknown> = options.forceBroadcast ? { gasLimit: options.forcedGasLimit ?? 300_000n } : {};
  let feeNote: string | undefined;
  let feeCap: bigint | undefined;
  if (options.fees) {
    try {
      const fees = await options.fees();
      if (fees) {
        overrides.maxFeePerGas = fees.maxFeePerGas;
        overrides.maxPriorityFeePerGas = fees.maxPriorityFeePerGas;
        feeCap = fees.maxFeePerGas;
        feeNote = `Suggested priority fee ${formatGwei(fees.maxPriorityFeePerGas)} (${fees.source})`;
      }
    } catch {
      // Let the wallet choose.
    }
  }

  // Gas limit and balance check before the wallet opens: a node refuses to
  // estimate gas the sender cannot pay for, which wallets surface as an
  // opaque error, so check it here and say so plainly.
  if (reader && call) {
    try {
      if (!options.forceBroadcast) {
        const estimate = await reader.estimateGas(call);
        overrides.gasLimit = estimate + estimate / 5n;
      }
      const gasLimit = overrides.gasLimit as bigint;
      if (feeCap === undefined) {
        const data = await reader.getFeeData();
        feeCap = data.maxFeePerGas ?? data.gasPrice ?? undefined;
      }
      if (feeCap !== undefined) {
        const worstCase = gasLimit * feeCap;
        const balance = await reader.getBalance(call.from);
        if (balance < worstCase) {
          const symbol = options.currencySymbol ?? "ETH";
          const fmt = (wei: bigint) => Number(formatEther(wei)).toLocaleString(undefined, { maximumSignificantDigits: 3 });
          return finish(
            {
              stage: "failed",
              error: {
                kind: "insufficient-funds",
                message: `Not enough ${symbol} for gas: this transaction can cost up to ${fmt(worstCase)} ${symbol}, but ${call.from.slice(0, 8)}… holds ${fmt(balance)} ${symbol}. Top it up from a faucet, then retry.`,
                detail: `gasLimit ${gasLimit} × maxFeePerGas ${feeCap} wei = ${worstCase} wei; balance ${balance} wei`,
              },
            },
            false,
          );
        }
      }
    } catch (error) {
      return rejected(error);
    }
  }

  emit({ stage: "awaiting-wallet", note: feeNote });
  let tx: ContractTransactionResponse;
  try {
    tx = (await fn(...args, overrides)) as ContractTransactionResponse;
  } catch (error) {
    // ethers attaches the hash when the wallet broadcast the transaction but
    // fetching it back failed; it may well be mined, so keep following it.
    const sentHash = (error as { info?: { sendTransactionHash?: string } }).info?.sendTransactionHash;
    if (sentHash) {
      emit({ stage: "submitted", txHash: sentHash as Hex, note: "Broadcast by the wallet; following it by hash" });
      return followByHash(contract, sentHash as Hex, options, finish, decodeError(error));
    }
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
    if (!receipt) return followByHash(contract, txHash, options, finish);
    return settle(contract, receipt, tx, finish);
  } catch (error) {
    // ethers throws CALL_EXCEPTION for receipts with status 0.
    const receipt = (error as { receipt?: TransactionReceipt }).receipt;
    if (receipt) return settle(contract, receipt, tx, finish);
    // No receipt: the wallet's provider failed while waiting. The
    // transaction may still confirm, so ask another provider before giving up.
    return followByHash(contract, txHash, options, finish, decodeError(error));
  }
}

type Finish = (update: Omit<SubmissionUpdate, "at">, ok: boolean) => SubmissionResult;

/** Turn a receipt into a confirmed or reverted result. */
async function settle(
  contract: Contract,
  receipt: TransactionReceipt,
  tx: { to?: string | null; from?: string; data?: string; value?: bigint } | null,
  finish: Finish,
): Promise<SubmissionResult> {
  const txHash = receipt.hash as Hex;
  if (receipt.status !== 1) {
    const reason = tx ? await recoverRevertReason(contract, tx, receipt.blockNumber) : null;
    return finish(
      {
        stage: "reverted",
        txHash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed,
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
}

/** Wait for a receipt by hash on a (preferably independent) provider. */
async function followByHash(
  contract: Contract,
  txHash: Hex,
  options: SubmitOptions,
  finish: Finish,
  cause?: DecodedError,
): Promise<SubmissionResult> {
  const provider = options.receiptProvider ?? contract.runner?.provider;
  if (provider) {
    try {
      const receipt = await provider.waitForTransaction(txHash, options.confirmations ?? 1, options.receiptTimeoutMs ?? 180_000);
      if (receipt) {
        const tx = await provider.getTransaction(txHash).catch(() => null);
        return settle(contract, receipt, tx, finish);
      }
    } catch {
      // Timed out or provider failure: report as unconfirmed below.
    }
  }
  return finish(
    {
      stage: "unconfirmed",
      txHash,
      error: {
        kind: "rpc",
        message:
          "The wallet broadcast this transaction, but no receipt was seen yet. It may still confirm: open it on the block explorer before resubmitting.",
        detail: cause?.detail ?? cause?.message,
      },
    },
    false,
  );
}

/**
 * Receipts do not carry revert data, so after a mined-but-reverted
 * transaction we replay the same call with eth_call on the state just before
 * its block to recover the contract's custom error. Best effort: returns null
 * if no CropLedger error can be decoded.
 */
async function recoverRevertReason(
  contract: Contract,
  tx: { to?: string | null; from?: string; data?: string; value?: bigint },
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
