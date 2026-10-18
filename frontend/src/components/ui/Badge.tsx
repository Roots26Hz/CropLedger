import type { ReactNode } from "react";
import { cn } from "../../utils/cn";

export type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "local";

const tones: Record<Tone, string> = {
  neutral: "bg-stone-100 text-ink-muted border-line",
  success: "bg-forest-50 text-forest-700 border-forest-200",
  warning: "bg-soil-50 text-soil-700 border-soil-100",
  danger: "bg-danger-50 text-danger-700 border-danger-100",
  info: "bg-chain-50 text-chain-700 border-chain-100",
  local: "bg-soil-50 text-soil-700 border-soil-100 border-dashed",
};

const dots: Record<Tone, string> = {
  neutral: "bg-ink-faint",
  success: "bg-forest-500",
  warning: "bg-soil-500",
  danger: "bg-danger-500",
  info: "bg-chain-500",
  local: "bg-soil-500",
};

export function Badge({
  tone = "neutral",
  children,
  dot,
  pulse,
  icon,
  className,
  title,
}: {
  tone?: Tone;
  children: ReactNode;
  dot?: boolean;
  pulse?: boolean;
  icon?: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      {dot && <span className={cn("size-1.5 rounded-full", dots[tone], pulse && "animate-pulse-soft")} />}
      {icon}
      {children}
    </span>
  );
}
