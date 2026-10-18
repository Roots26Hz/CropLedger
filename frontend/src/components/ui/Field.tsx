import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "../../utils/cn";

const control =
  "w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-faint focus:border-forest-500 focus:ring-2 focus:ring-forest-100 focus:outline-none disabled:bg-surface-2 disabled:text-ink-faint";

export function Field({
  label,
  hint,
  error,
  children,
  className,
  htmlFor,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-ink-muted">
        {label}
      </label>
      {children}
      {error ? <p className="text-xs text-danger-600">{error}</p> : hint ? <p className="text-xs text-ink-faint">{hint}</p> : null}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cn(control, "h-10", className)} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cn(control, "h-10 pr-8", className)}>
      {children}
    </select>
  );
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cn(control, "py-2 font-mono text-[12px] leading-relaxed", className)} />;
}
