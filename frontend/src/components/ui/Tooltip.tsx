import { HelpCircle } from "lucide-react";
import { useId, type ReactNode } from "react";

/** Small "?" icon that reveals an explanation on hover or keyboard focus. */
export function InfoTip({ children, label = "More information" }: { children: ReactNode; label?: string }) {
  const id = useId();
  return (
    <span className="group relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        className="rounded-full text-ink-faint transition-colors hover:text-ink focus:text-ink"
      >
        <HelpCircle className="size-3.5" />
      </button>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none invisible absolute bottom-full left-1/2 z-40 mb-2 w-64 -translate-x-1/2 rounded-lg bg-forest-950 px-3 py-2 text-[12px] leading-relaxed font-normal text-white opacity-0 shadow-[var(--shadow-pop)] transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
      >
        {children}
      </span>
    </span>
  );
}
