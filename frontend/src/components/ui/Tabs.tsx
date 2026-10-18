import type { ReactNode } from "react";
import { cn } from "../../utils/cn";

export interface TabItem<K extends string> {
  key: K;
  label: ReactNode;
  icon?: ReactNode;
}

export function Tabs<K extends string>({
  items,
  active,
  onChange,
  className,
}: {
  items: TabItem<K>[];
  active: K;
  onChange: (key: K) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={cn("inline-flex rounded-lg border border-line bg-surface-2 p-1", className)}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          aria-selected={active === item.key}
          onClick={() => onChange(item.key)}
          className={cn(
            "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            active === item.key ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink",
          )}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  );
}
