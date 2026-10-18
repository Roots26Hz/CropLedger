import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../../utils/cn";
import { Spinner } from "./Spinner";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md";

const variants: Record<Variant, string> = {
  primary: "bg-forest-600 text-white hover:bg-forest-700 shadow-sm disabled:bg-forest-300",
  secondary: "bg-forest-50 text-forest-800 hover:bg-forest-100 border border-forest-200",
  outline: "bg-surface text-ink border border-line-strong hover:bg-surface-2",
  ghost: "text-ink-muted hover:text-ink hover:bg-black/5",
  danger: "bg-danger-600 text-white hover:bg-danger-700 shadow-sm disabled:bg-danger-100",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  loading?: boolean;
  /** Shown as a tooltip and to screen readers when the button is disabled. */
  disabledReason?: string;
}

export function Button({
  variant = "primary",
  size = "md",
  icon,
  loading,
  disabled,
  disabledReason,
  className,
  children,
  title,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <button
      type="button"
      {...rest}
      disabled={isDisabled}
      title={isDisabled && disabledReason ? disabledReason : title}
      aria-disabled={isDisabled}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-lg font-medium whitespace-nowrap transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-60",
        variants[variant],
        sizes[size],
        className,
      )}
    >
      {loading ? <Spinner className="size-4" /> : icon}
      {children}
    </button>
  );
}
