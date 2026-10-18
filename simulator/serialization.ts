/**
 * JSON (de)serialization of signed readings. bigint values are stored as
 * decimal strings so records can be saved to files or localStorage and
 * exported/imported between the CLI and the dashboard.
 */
import { validatePayload } from "./payload.js";
import type { Hex, SignedReading } from "./types.js";

export interface SignedReadingJson {
  kind: "cropledger.signed-reading";
  payload: SignedReading["payload"];
  canonicalJson: string;
  payloadHash: Hex;
  message: Omit<SignedReading["message"], "timestamp" | "nonce"> & { timestamp: string; nonce: string };
  signature: Hex;
  signer: string;
  domain: { chainId: string; verifyingContract: string };
}

export function signedReadingToJson(signed: SignedReading): SignedReadingJson {
  return {
    kind: "cropledger.signed-reading",
    payload: signed.payload,
    canonicalJson: signed.canonicalJson,
    payloadHash: signed.payloadHash,
    message: { ...signed.message, timestamp: signed.message.timestamp.toString(), nonce: signed.message.nonce.toString() },
    signature: signed.signature,
    signer: signed.signer,
    domain: { chainId: signed.domain.chainId.toString(), verifyingContract: signed.domain.verifyingContract },
  };
}

export function signedReadingFromJson(json: SignedReadingJson): SignedReading {
  if (json.kind !== "cropledger.signed-reading") throw new Error("Not a CropLedger signed reading");
  return {
    payload: validatePayload(json.payload),
    canonicalJson: json.canonicalJson,
    payloadHash: json.payloadHash,
    message: { ...json.message, timestamp: BigInt(json.message.timestamp), nonce: BigInt(json.message.nonce) },
    signature: json.signature,
    signer: json.signer,
    domain: { chainId: BigInt(json.domain.chainId), verifyingContract: json.domain.verifyingContract },
  };
}
