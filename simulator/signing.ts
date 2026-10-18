/**
 * EIP-712 signing scheme for CropLedger readings.
 *
 * Domain   { name: "CropLedger", version: "1", chainId, verifyingContract }
 * Type     Reading(bytes32 deviceId,bytes32 fieldId,uint64 timestamp,
 *                  uint16 n,uint16 p,uint16 k,uint64 nonce,bytes32 payloadHash)
 *
 * The contract rebuilds exactly this struct (taking fieldId from the device
 * registry) and recovers the signer with OpenZeppelin's ECDSA library.
 * Including the domain prevents a signature from being replayed on another
 * chain or contract; including deviceId/fieldId/nonce prevents it from being
 * reused for another device, field or submission.
 */
import {
  TypedDataEncoder,
  keccak256,
  toUtf8Bytes,
  verifyTypedData,
  type TypedDataDomain,
  type TypedDataField,
} from "ethers";
import { toBytes32Id } from "./ids.js";
import { canonicalize, hashCanonicalJson } from "./payload.js";
import type {
  DeploymentDomain,
  Hex,
  ReadingMessage,
  ReadingPayload,
  SignedReading,
  SubmitReadingArgs,
} from "./types.js";

export const EIP712_NAME = "CropLedger";
export const EIP712_VERSION = "1";

export const READING_TYPE_STRING =
  "Reading(bytes32 deviceId,bytes32 fieldId,uint64 timestamp,uint16 n,uint16 p,uint16 k,uint64 nonce,bytes32 payloadHash)";

/** keccak256 of the type string; must equal CropLedger.READING_TYPEHASH(). */
export const READING_TYPEHASH = keccak256(toUtf8Bytes(READING_TYPE_STRING)) as Hex;

export const READING_TYPES: Record<string, TypedDataField[]> = {
  Reading: [
    { name: "deviceId", type: "bytes32" },
    { name: "fieldId", type: "bytes32" },
    { name: "timestamp", type: "uint64" },
    { name: "n", type: "uint16" },
    { name: "p", type: "uint16" },
    { name: "k", type: "uint16" },
    { name: "nonce", type: "uint64" },
    { name: "payloadHash", type: "bytes32" },
  ],
};

/**
 * Domain used by the in-browser local demonstration ledger. Chain ID 0 and the
 * zero address do not correspond to any real deployment, so signatures made
 * in local mode can never be accepted by a real CropLedger contract.
 */
export const LOCAL_DEMO_DOMAIN: DeploymentDomain = {
  chainId: 0n,
  verifyingContract: "0x0000000000000000000000000000000000000000",
};

/** Anything that can produce EIP-712 signatures (ethers Wallet, JsonRpcSigner…). */
export interface TypedDataSigner {
  getAddress(): Promise<string>;
  signTypedData(
    domain: TypedDataDomain,
    types: Record<string, TypedDataField[]>,
    value: Record<string, unknown>,
  ): Promise<string>;
}

export function typedDataDomain(domain: DeploymentDomain): TypedDataDomain {
  return {
    name: EIP712_NAME,
    version: EIP712_VERSION,
    chainId: domain.chainId,
    verifyingContract: domain.verifyingContract,
  };
}

/** Build the signed message from a payload (hashing the canonical JSON). */
export function messageFromPayload(payload: ReadingPayload): {
  canonicalJson: string;
  payloadHash: Hex;
  message: ReadingMessage;
} {
  const canonicalJson = canonicalize(payload);
  const payloadHash = hashCanonicalJson(canonicalJson);
  return {
    canonicalJson,
    payloadHash,
    message: {
      deviceId: toBytes32Id(payload.deviceId),
      fieldId: toBytes32Id(payload.fieldId),
      timestamp: BigInt(payload.timestamp),
      n: payload.n,
      p: payload.p,
      k: payload.k,
      nonce: BigInt(payload.nonce),
      payloadHash,
    },
  };
}

/** The EIP-712 digest (what ECDSA actually signs). */
export function readingDigest(domain: DeploymentDomain, message: ReadingMessage): Hex {
  return TypedDataEncoder.hash(
    typedDataDomain(domain),
    READING_TYPES,
    message as unknown as Record<string, unknown>,
  ) as Hex;
}

/** Recover the address that signed a reading message. */
export function recoverReadingSigner(
  domain: DeploymentDomain,
  message: ReadingMessage,
  signature: string,
): string {
  return verifyTypedData(
    typedDataDomain(domain),
    READING_TYPES,
    message as unknown as Record<string, unknown>,
    signature,
  );
}

/** Sign a payload with a device key and return everything needed to submit it. */
export async function signReading(
  deviceSigner: TypedDataSigner,
  domain: DeploymentDomain,
  payload: ReadingPayload,
): Promise<SignedReading> {
  const { canonicalJson, payloadHash, message } = messageFromPayload(payload);
  const signature = (await deviceSigner.signTypedData(
    typedDataDomain(domain),
    READING_TYPES,
    message as unknown as Record<string, unknown>,
  )) as Hex;
  const signer = recoverReadingSigner(domain, message, signature);
  const expected = await deviceSigner.getAddress();
  if (signer.toLowerCase() !== expected.toLowerCase()) {
    throw new Error("Signature self-check failed: recovered address differs from device key");
  }
  return { payload, canonicalJson, payloadHash, message, signature, signer, domain };
}

/** Convert a signed reading into CropLedger.submitReading arguments. */
export function toSubmitArgs(signed: Pick<SignedReading, "message" | "signature">): SubmitReadingArgs {
  const { message, signature } = signed;
  return [
    message.deviceId,
    {
      timestamp: message.timestamp,
      n: message.n,
      p: message.p,
      k: message.k,
      payloadHash: message.payloadHash,
    },
    message.nonce,
    signature,
  ];
}
