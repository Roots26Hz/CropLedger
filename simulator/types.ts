/**
 * Shared types for the CropLedger edge simulator, gateway and dashboard.
 * Everything in simulator/ is plain TypeScript + ethers so the same code runs
 * in Node (CLI, Hardhat tests) and in the browser (dashboard).
 */

/** 0x-prefixed hex string. */
export type Hex = `0x${string}`;

/** Label produced by the device's on-board anomaly detector. */
export type AnomalyLabel = "normal" | "anomaly";

/**
 * Canonical off-chain reading payload (schema v1).
 *
 * All numeric values are integers so that serialization is deterministic
 * across languages; fractional quantities are scaled (see field comments).
 */
export interface ReadingPayload {
  schema: "cropledger.reading.v1";
  /** Human-readable device ID (encoded as bytes32 on-chain). */
  deviceId: string;
  /** Human-readable field ID (encoded as bytes32 on-chain). */
  fieldId: string;
  /** Firmware version string reported by the device. */
  firmware: string;
  /** Unix time in seconds at which the device sampled. */
  timestamp: number;
  /** Per-device strictly increasing counter (starts at 1). */
  nonce: number;
  /** Nitrogen, mg/kg. */
  n: number;
  /** Phosphorus, mg/kg. */
  p: number;
  /** Potassium, mg/kg. */
  k: number;
  /** Volumetric soil moisture in basis points (2345 = 23.45 %). */
  soilMoistureBp: number;
  /** Soil temperature in hundredths of a degree Celsius (2410 = 24.10 °C). */
  soilTempCentiC: number;
  /** Soil pH multiplied by 100 (652 = pH 6.52). */
  phCenti: number;
  /** Edge-AI anomaly score multiplied by 1000 (max |z-score| of N, P, K). */
  anomalyScoreMilli: number;
  /** Edge-AI classification of this reading. */
  anomalyLabel: AnomalyLabel;
}

/** The EIP-712 `Reading` message the device signs (matches CropLedger.sol). */
export interface ReadingMessage {
  deviceId: Hex;
  fieldId: Hex;
  timestamp: bigint;
  n: number;
  p: number;
  k: number;
  nonce: bigint;
  payloadHash: Hex;
}

/** EIP-712 domain parameters that vary per deployment. */
export interface DeploymentDomain {
  chainId: bigint;
  verifyingContract: string;
}

/** A payload together with its hash, the signed message and the signature. */
export interface SignedReading {
  payload: ReadingPayload;
  canonicalJson: string;
  payloadHash: Hex;
  message: ReadingMessage;
  signature: Hex;
  /** Address recovered from the signature at signing time. */
  signer: string;
  domain: DeploymentDomain;
}

/** Arguments for CropLedger.submitReading(deviceId, r, nonce, signature). */
export type SubmitReadingArgs = [
  deviceId: Hex,
  reading: { timestamp: bigint; n: number; p: number; k: number; payloadHash: Hex },
  nonce: bigint,
  signature: Hex,
];
