/**
 * Canonical payload construction, validation and hashing.
 *
 * Canonical form (schema "cropledger.reading.v1"):
 *   - a JSON object with exactly the keys in PAYLOAD_KEYS, in that order;
 *   - no whitespace (JSON.stringify without indentation);
 *   - every number is a safe integer, every string is printable ASCII.
 *
 *   payloadHash = keccak256(utf8(canonicalJson))
 *
 * Because the key order and value formats are fixed, the same reading always
 * produces byte-identical JSON and therefore the same hash, on any machine.
 * Changing any value (even by one unit) produces a completely different hash.
 */
import { keccak256, toUtf8Bytes } from "ethers";
import { isValidId } from "./ids.js";
import type { AnomalyLabel, Hex, ReadingPayload } from "./types.js";

export const PAYLOAD_SCHEMA = "cropledger.reading.v1" as const;

/** Fixed key order of the canonical JSON. */
export const PAYLOAD_KEYS = [
  "schema",
  "deviceId",
  "fieldId",
  "firmware",
  "timestamp",
  "nonce",
  "n",
  "p",
  "k",
  "soilMoistureBp",
  "soilTempCentiC",
  "phCenti",
  "anomalyScoreMilli",
  "anomalyLabel",
] as const satisfies readonly (keyof ReadingPayload)[];

/** Must mirror CropLedger.MAX_NUTRIENT_VALUE. */
export const MAX_NUTRIENT_VALUE = 10_000;

type IntegerKey = Exclude<
  keyof ReadingPayload,
  "schema" | "deviceId" | "fieldId" | "firmware" | "anomalyLabel"
>;

/** Inclusive integer ranges for numeric fields. */
const INTEGER_RANGES: Record<IntegerKey, readonly [number, number]> = {
  timestamp: [1, 2 ** 40],
  nonce: [1, Number.MAX_SAFE_INTEGER],
  n: [0, MAX_NUTRIENT_VALUE],
  p: [0, MAX_NUTRIENT_VALUE],
  k: [0, MAX_NUTRIENT_VALUE],
  soilMoistureBp: [0, 10_000],
  soilTempCentiC: [-4_000, 8_000],
  phCenti: [0, 1_400],
  anomalyScoreMilli: [0, 1_000_000],
};

const ANOMALY_LABELS: readonly AnomalyLabel[] = ["normal", "anomaly"];
const PRINTABLE_ASCII = /^[\x20-\x7E]{1,64}$/;

/** Raised when a payload does not conform to the canonical schema. */
export class PayloadValidationError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(`${field}: ${message}`);
    this.name = "PayloadValidationError";
  }
}

/**
 * Validate an arbitrary value (e.g. parsed JSON) against schema v1 and return
 * a typed payload. Unknown keys are rejected so that nothing outside the
 * hashed fields can masquerade as evidence.
 */
export function validatePayload(value: unknown): ReadingPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PayloadValidationError("payload", "must be a JSON object");
  }
  const record = value as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (!(PAYLOAD_KEYS as readonly string[]).includes(key)) {
      throw new PayloadValidationError(key, "is not part of schema v1");
    }
  }
  for (const key of PAYLOAD_KEYS) {
    if (!(key in record)) throw new PayloadValidationError(key, "is missing");
  }

  if (record.schema !== PAYLOAD_SCHEMA) {
    throw new PayloadValidationError("schema", `must be "${PAYLOAD_SCHEMA}"`);
  }
  for (const key of ["deviceId", "fieldId"] as const) {
    const id = record[key];
    if (typeof id !== "string" || !isValidId(id)) {
      throw new PayloadValidationError(key, "must be 1-31 characters [A-Za-z0-9._:-]");
    }
  }
  if (typeof record.firmware !== "string" || !PRINTABLE_ASCII.test(record.firmware)) {
    throw new PayloadValidationError("firmware", "must be printable ASCII (1-64 chars)");
  }
  for (const [key, [min, max]] of Object.entries(INTEGER_RANGES)) {
    const v = record[key];
    if (typeof v !== "number" || !Number.isSafeInteger(v)) {
      throw new PayloadValidationError(key, "must be an integer");
    }
    if (v < min || v > max) {
      throw new PayloadValidationError(key, `must be between ${min} and ${max}`);
    }
  }
  if (!ANOMALY_LABELS.includes(record.anomalyLabel as AnomalyLabel)) {
    throw new PayloadValidationError("anomalyLabel", `must be one of ${ANOMALY_LABELS.join(", ")}`);
  }

  // Rebuild in canonical order so the returned object has no extra properties.
  return Object.fromEntries(PAYLOAD_KEYS.map((key) => [key, record[key]])) as unknown as ReadingPayload;
}

/** Deterministic serialization used for hashing. Validates first. */
export function canonicalize(payload: ReadingPayload): string {
  const valid = validatePayload(payload);
  const ordered: Record<string, unknown> = {};
  for (const key of PAYLOAD_KEYS) ordered[key] = valid[key];
  return JSON.stringify(ordered);
}

/** keccak256 of the canonical JSON (UTF-8). */
export function hashCanonicalJson(canonicalJson: string): Hex {
  return keccak256(toUtf8Bytes(canonicalJson)) as Hex;
}

/** Hash of a payload: keccak256(utf8(canonicalize(payload))). */
export function hashPayload(payload: ReadingPayload): Hex {
  return hashCanonicalJson(canonicalize(payload));
}

/** Parse JSON text (e.g. pasted into the Verification Lab) into a payload. */
export function parsePayloadJson(text: string): ReadingPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new PayloadValidationError("payload", `is not valid JSON (${(error as Error).message})`);
  }
  return validatePayload(parsed);
}

/** Human-friendly multi-line rendering (NOT used for hashing). */
export function prettyPayload(payload: ReadingPayload): string {
  return JSON.stringify(JSON.parse(canonicalize(payload)), null, 2);
}
