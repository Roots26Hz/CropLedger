/**
 * Safe localStorage helpers. Storage can be unavailable (private windows,
 * blocked site data), so every access is wrapped and falls back gracefully.
 * Only demonstration data lives here; nothing in it is authoritative — the
 * blockchain (or the clearly labelled local demo ledger) is.
 */
const PREFIX = "cropledger.";

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key: string): void {
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    // ignore
  }
}

/** Remove every CropLedger key whose name starts with the given prefix. */
export function removeByPrefix(prefix: string): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(PREFIX + prefix)) keys.push(key);
    }
    for (const key of keys) window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

/** Random identifier for UI records. */
export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
