import type { ReactNode } from "react";
import { cn } from "../utils/cn";
import { InfoTip } from "./ui/Tooltip";

export function StatCard({
  label,
  value,
  detail,
  icon,
  tip,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  icon?: ReactNode;
  tip?: ReactNode;
  tone?: "default" | "danger";
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
          {label}
          {tip && <InfoTip>{tip}</InfoTip>}
        </p>
        {icon && <span className={cn("rounded-lg p-1.5", tone === "danger" ? "bg-danger-50 text-danger-600" : "bg-forest-50 text-forest-600")}>{icon}</span>}
      </div>
      <p className="tabular mt-2 text-2xl font-semibold tracking-tight text-ink">{value}</p>
      {detail && <p className="mt-0.5 text-xs text-ink-faint">{detail}</p>}
    </div>
  );
}
