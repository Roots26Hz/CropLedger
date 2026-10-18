import { shortHex } from "@core/ids.js";

export { shortHex };

/** Unix seconds (number or bigint) → local date-time string. */
export function formatDateTime(seconds: number | bigint): string {
  const ms = Number(seconds) * 1000;
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Milliseconds timestamp → time of day. */
export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Human relative time ("12 s ago"). */
export function relativeTime(ms: number, now = Date.now()): string {
  const diff = Math.round((now - ms) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff} s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return `${Math.floor(diff / 86400)} d ago`;
}

export function formatNumber(value: number | bigint): string {
  return Number(value).toLocaleString();
}

/** Scaled integers from the payload → display strings. */
export const fmt = {
  moisture: (bp: number) => `${(bp / 100).toFixed(1)} %`,
  temperature: (centi: number) => `${(centi / 100).toFixed(1)} °C`,
  ph: (centi: number) => (centi / 100).toFixed(2),
  score: (milli: number) => (milli / 1000).toFixed(2),
};
