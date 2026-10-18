import type { ReactNode } from "react";
import { cn } from "../../utils/cn";

export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-10 text-center", className)}>
      {icon && <div className="mb-3 rounded-full bg-forest-50 p-3 text-forest-600">{icon}</div>}
      <p className="text-sm font-semibold text-ink">{title}</p>
      {children && <div className="mt-1 max-w-md text-[13px] text-ink-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
