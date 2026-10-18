import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../utils/cn";

type CalloutTone = "info" | "warning" | "danger" | "success";

const styles: Record<CalloutTone, { box: string; icon: ReactNode }> = {
  info: { box: "bg-chain-50 border-chain-100 text-chain-700", icon: <Info className="size-4" /> },
  warning: { box: "bg-soil-50 border-soil-100 text-soil-700", icon: <AlertTriangle className="size-4" /> },
  danger: { box: "bg-danger-50 border-danger-100 text-danger-700", icon: <XCircle className="size-4" /> },
  success: { box: "bg-forest-50 border-forest-200 text-forest-700", icon: <CheckCircle2 className="size-4" /> },
};

export function Callout({
  tone = "info",
  title,
  children,
  action,
  className,
}: {
  tone?: CalloutTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const s = styles[tone];
  return (
    <div role={tone === "danger" ? "alert" : "note"} className={cn("flex gap-3 rounded-lg border px-4 py-3 text-sm", s.box, className)}>
      <div className="mt-0.5 shrink-0">{s.icon}</div>
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn("text-[13px] leading-relaxed", Boolean(title) && "mt-0.5", "text-ink-muted [&_strong]:text-ink")}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}
