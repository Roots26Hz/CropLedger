/**
 * Helpers for the human-readable identifiers used by CropLedger.
 *
 * Device and field IDs are short ASCII strings (e.g. "CL-DEV-0001",
 * "FIELD-A1") stored on-chain as bytes32 using ethers'
 * encodeBytes32String, so they remain readable in Remix and on explorers.
 */
import { decodeBytes32String, encodeBytes32String, sha256, toUtf8Bytes } from "ethers";
import type { Hex } from "./types.js";

/** Allowed characters for device / field IDs (max 31 bytes for bytes32). */
export const ID_PATTERN = /^[A-Za-z0-9._:-]{1,31}$/;

export function isValidId(id: string): boolean {
  return ID_PATTERN.test(id);
}

/** Encode a human-readable ID as bytes32. Throws on invalid IDs. */
export function toBytes32Id(id: string): Hex {
  if (!isValidId(id)) {
    throw new Error(
      `Invalid ID "${id}": use 1-31 characters from A-Z, a-z, 0-9, '.', '_', ':' or '-'.`,
    );
  }
  return encodeBytes32String(id) as Hex;
}

/** Decode a bytes32 ID for display; falls back to the hex value. */
export function fromBytes32Id(value: string): string {
  try {
    const decoded = decodeBytes32String(value);
    return isValidId(decoded) ? decoded : value;
  } catch {
    return value;
  }
}

/**
 * Simulated firmware image hash. A real device would report the SHA-256 of
 * its flashed firmware; the simulator hashes a descriptive string instead.
 */
export function firmwareHashFor(version: string): Hex {
  return sha256(toUtf8Bytes(`CropLedger edge firmware ${version}`)) as Hex;
}

/** Shorten a hex string for display: 0x1234…abcd. */
export function shortHex(value: string, chars = 4): string {
  if (!value || value.length <= 2 + chars * 2 + 1) return value;
  return `${value.slice(0, 2 + chars)}…${value.slice(-chars)}`;
}
