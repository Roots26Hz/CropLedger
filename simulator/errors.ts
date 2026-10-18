/**
 * Turns contract reverts, wallet errors and RPC failures into short,
 * human-readable explanations. Shared by the CLI gateway and the dashboard.
 */
import { Interface, isError, type ErrorDescription } from "ethers";
import { CROPLEDGER_ABI } from "./abi.js";
import { fromBytes32Id } from "./ids.js";

export type ErrorKind =
  | "contract" // the contract (or local ledger) rejected the call
  | "wallet-rejected" // the user rejected the request in the wallet
  | "wallet-pending" // a wallet request is already open
  | "wallet-missing" // no injected wallet available
  | "wrong-network"
  | "insufficient-funds"
  | "fee-too-low" // the node refused the signed transaction's gas fee
  | "nonce-conflict" // the account's transaction nonce is out of sync
  | "rpc" // network / provider failure
  | "validation" // bad input caught before sending
  | "unknown";

export interface DecodedError {
  kind: ErrorKind;
  /** Contract error name when kind === "contract" (e.g. "StaleNonce"). */
  name?: string;
  /** One-sentence explanation suitable for the UI. */
  message: string;
  /** Raw technical detail for the curious. */
  detail?: string;
}

/** Error thrown by the in-browser LocalLedger, named like the contract errors. */
export class LedgerRuleError extends Error {
  constructor(
    readonly errorName: string,
    readonly args: readonly unknown[] = [],
  ) {
    super(`${errorName}(${args.map(String).join(", ")})`);
    this.name = "LedgerRuleError";
  }
}

const cropLedgerInterface = new Interface(CROPLEDGER_ABI);

function id(value: unknown): string {
  return typeof value === "string" ? fromBytes32Id(value) : String(value);
}

/** Friendly text for each CropLedger custom error. */
export function describeContractError(name: string, args: readonly unknown[] = []): string {
  switch (name) {
    case "UnknownDevice":
      return `Device ${id(args[0])} is not registered, so its readings are rejected.`;
    case "DeviceNotActive":
      return `Device ${id(args[0])} has been revoked; new readings from it are rejected.`;
    case "StaleNonce":
      return `Replay rejected: nonce ${String(args[1])} is not greater than the last accepted nonce ${String(args[2])} for ${id(args[0])}.`;
    case "InvalidSignature":
      return `Signature check failed for ${id(args[0])}: the data was not signed by the registered device key, or was altered after signing.`;
    case "InvalidTimestamp":
      return `Reading timestamp ${String(args[0])} is zero or too far in the future.`;
    case "NutrientValueOutOfRange":
      return `Nutrient values N=${String(args[0])}, P=${String(args[1])}, K=${String(args[2])} exceed the allowed maximum.`;
    case "InvalidPayloadHash":
      return "The payload hash is empty.";
    case "DeviceAlreadyRegistered":
      return `Device ID ${id(args[0])} is already registered (IDs can never be reused).`;
    case "SignerAlreadyAssigned":
      return `That signing key already belongs to device ${id(args[1])}.`;
    case "InvalidDeviceId":
      return "Device ID must not be empty.";
    case "InvalidSigner":
      return "Signer address must not be the zero address.";
    case "InvalidFieldId":
      return "Field ID must not be empty.";
    case "InvalidFirmwareHash":
      return "Firmware hash must not be empty.";
    case "ReadingIndexOutOfBounds":
      return `Reading #${String(args[1])} does not exist for ${id(args[0])} (it has ${String(args[2])} readings).`;
    case "DeviceIndexOutOfBounds":
      return `Device index ${String(args[0])} is out of range.`;
    case "OwnableUnauthorizedAccount":
      return `Only the contract owner can do this; ${String(args[0])} is not the owner.`;
    case "OwnableInvalidOwner":
      return "The owner address is invalid.";
    default:
      return `The contract rejected the call (${name}).`;
  }
}

function findCode(err: unknown, depth = 0): unknown {
  if (!err || typeof err !== "object" || depth > 4) return undefined;
  const e = err as Record<string, unknown>;
  if (e.code !== undefined && typeof e.code === "number") return e.code;
  return findCode(e.error, depth + 1) ?? findCode(e.info, depth + 1) ?? findCode(e.cause, depth + 1);
}

function findRevertData(err: unknown, depth = 0): string | undefined {
  if (!err || typeof err !== "object" || depth > 5) return undefined;
  const e = err as Record<string, unknown>;
  if (typeof e.data === "string" && e.data.startsWith("0x") && e.data.length >= 10) return e.data;
  if (e.data && typeof e.data === "object") {
    const nested = findRevertData(e.data, depth + 1);
    if (nested) return nested;
  }
  return findRevertData(e.error, depth + 1) ?? findRevertData(e.info, depth + 1) ?? findRevertData(e.cause, depth + 1);
}

function shortMessage(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { shortMessage?: unknown; message?: unknown };
    if (typeof e.shortMessage === "string") return e.shortMessage;
    if (typeof e.message === "string") return e.message.split("\n")[0]!.slice(0, 300);
  }
  return String(err);
}

/** Wrapper messages that say nothing about the actual cause. */
const GENERIC_MESSAGE = /^(internal json-rpc error\.?|could not coalesce error|unknown error|missing revert data|execution reverted\.?)$/i;

/**
 * Collect every message nested inside an error (ethers wraps MetaMask, which
 * wraps the node's own error), most specific last.
 */
function nestedMessages(err: unknown, depth = 0, out: string[] = []): string[] {
  if (!err || typeof err !== "object" || depth > 6) return out;
  const e = err as Record<string, unknown>;
  for (const key of ["shortMessage", "message"] as const) {
    const value = e[key];
    if (typeof value === "string" && value.trim()) out.push(value.split("\n")[0]!.slice(0, 400));
  }
  for (const key of ["error", "info", "data", "originalError", "cause", "payload"] as const) {
    if (e[key] && typeof e[key] === "object") nestedMessages(e[key], depth + 1, out);
  }
  return out;
}

/** The most specific human-readable cause inside an error. */
function specificMessage(err: unknown): string {
  const messages = nestedMessages(err)
    .map((m) => m.replace(/\s*\(.*$/s, "").trim())
    .filter((m) => m && !GENERIC_MESSAGE.test(m));
  return messages.at(-1) ?? shortMessage(err);
}

/** Decode any error from ethers, MetaMask, the LocalLedger or our own checks. */
export function decodeError(err: unknown): DecodedError {
  if (err instanceof LedgerRuleError) {
    return {
      kind: "contract",
      name: err.errorName,
      message: describeContractError(err.errorName, err.args),
      detail: `Local demo ledger: ${err.message}`,
    };
  }

  // Contract revert with custom-error data.
  const revert = (err as { revert?: { name?: string; args?: unknown[] } } | undefined)?.revert;
  if (revert?.name) {
    return { kind: "contract", name: revert.name, message: describeContractError(revert.name, revert.args ?? []), detail: shortMessage(err) };
  }
  const data = findRevertData(err);
  if (data) {
    let parsed: ErrorDescription | null;
    try {
      parsed = cropLedgerInterface.parseError(data);
    } catch {
      parsed = null;
    }
    if (parsed) {
      return { kind: "contract", name: parsed.name, message: describeContractError(parsed.name, [...parsed.args]), detail: shortMessage(err) };
    }
  }

  if (isError(err, "ACTION_REJECTED") || findCode(err) === 4001) {
    return { kind: "wallet-rejected", message: "You rejected the request in your wallet. Nothing was sent.", detail: shortMessage(err) };
  }
  if (findCode(err) === -32002) {
    return { kind: "wallet-pending", message: "A wallet request is already open. Open MetaMask to approve or reject it.", detail: shortMessage(err) };
  }
  // Node-level rejections that wallets report as generic "Internal JSON-RPC
  // error" — look inside for the node's actual message.
  const all = nestedMessages(err).join(" | ");
  const detail = specificMessage(err);
  if (/replacement transaction underpriced|nonce too low|nonce has already been used|nonce too high/i.test(all)) {
    return {
      kind: "nonce-conflict",
      message:
        "The wallet's transaction counter (nonce) is out of sync with the network, e.g. after an earlier stuck transaction or a restarted local chain. In MetaMask use Settings → Advanced → Clear activity tab data, then try again.",
      detail,
    };
  }
  if (/underpriced|gas tip cap|minimum needed|max fee per gas less than block base fee|fee cap less than block base fee|maxFeePerGas.*too low/i.test(all)) {
    return {
      kind: "fee-too-low",
      message:
        "The network refused the transaction because its gas fee was too low. Polygon requires a priority fee (tip) of at least 25 gwei; if you edit the fee in MetaMask, keep it at or above that.",
      detail,
    };
  }
  if (isError(err, "INSUFFICIENT_FUNDS") || /insufficient funds/i.test(all)) {
    return { kind: "insufficient-funds", message: "The sending account does not have enough test tokens to pay for gas. Use a faucet first.", detail };
  }
  if (/\b429\b|too many requests|rate limit|request limit|exceeded/i.test(all)) {
    return {
      kind: "rpc",
      message: "The RPC endpoint is rate-limiting requests. Wait a few seconds and retry, or choose another Amoy RPC (System Configuration, or the network settings in MetaMask).",
      detail,
    };
  }
  if (isError(err, "CALL_EXCEPTION")) {
    return { kind: "contract", message: "The transaction reverted on-chain without a decodable reason.", detail: shortMessage(err) };
  }
  if (
    isError(err, "NETWORK_ERROR") ||
    isError(err, "SERVER_ERROR") ||
    isError(err, "TIMEOUT") ||
    (err instanceof TypeError && /fetch|network/i.test(err.message))
  ) {
    return { kind: "rpc", message: "Could not reach the blockchain RPC endpoint. Check your connection or RPC URL.", detail: shortMessage(err) };
  }
  if (isError(err, "INVALID_ARGUMENT") || isError(err, "BAD_DATA")) {
    return { kind: "validation", message: detail, detail };
  }
  return { kind: "unknown", message: detail, detail: shortMessage(err) !== detail ? shortMessage(err) : undefined };
}
