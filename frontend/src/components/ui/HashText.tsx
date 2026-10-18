import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { cn } from "../../utils/cn";
import { shortHex } from "../../utils/format";

export function CopyButton({ value, label = "Copy", className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? "Copied" : label}
      aria-label={label}
      className={cn("rounded p-1 text-ink-faint transition-colors hover:bg-black/5 hover:text-ink", className)}
    >
      {copied ? <Check className="size-3.5 text-forest-600" /> : <Copy className="size-3.5" />}
    </button>
  );
}

/** Monospace hash/address with optional shortening, copy and link. */
export function HashText({
  value,
  short = true,
  chars = 6,
  copy = true,
  href,
  className,
}: {
  value: string;
  short?: boolean;
  chars?: number;
  copy?: boolean;
  href?: string;
  className?: string;
}) {
  const text = short ? shortHex(value, chars) : value;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-0.5 font-mono text-[12px]", className)}>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          title={`${value} — opens the block explorer in a new tab`}
          className="inline-flex items-center gap-1 text-chain-600 underline decoration-chain-100 underline-offset-2 hover:decoration-chain-500"
        >
          <span className={cn(!short && "break-all")}>{text}</span>
          <ExternalLink className="size-3 shrink-0" />
        </a>
      ) : (
        <span title={value} className={cn(!short && "break-all")}>
          {text}
        </span>
      )}
      {copy && <CopyButton value={value} label="Copy full value" />}
    </span>
  );
}
