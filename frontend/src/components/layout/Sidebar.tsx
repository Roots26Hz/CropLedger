import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../utils/cn";

export interface NavItem {
  key: string;
  label: string;
  icon: ReactNode;
  group: "Monitor" | "Evidence" | "System";
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="size-8" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="#21402c" />
        <path d="M16 6c-5 3-7.5 7-7.5 11.2C8.5 21.6 11.8 25 16 25s7.5-3.4 7.5-7.8C23.5 13 21 9 16 6z" fill="#4f9c6b" />
        <path d="M16 9.5v15" stroke="#eef6f0" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M16 15l-3.4-2.6M16 19l3.6-2.8" stroke="#eef6f0" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      <div className="leading-tight">
        <p className="text-[15px] font-semibold tracking-tight text-white">CropLedger</p>
        <p className="text-[11px] text-forest-200/80">Field evidence on-chain</p>
      </div>
    </div>
  );
}

export function Sidebar({
  items,
  active,
  onNavigate,
  open,
  onClose,
  footer,
}: {
  items: NavItem[];
  active: string;
  onNavigate: (key: string) => void;
  open: boolean;
  onClose: () => void;
  footer?: ReactNode;
}) {
  const groups = ["Monitor", "Evidence", "System"] as const;
  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={cn("fixed inset-0 z-30 bg-forest-950/40 lg:hidden", open ? "block" : "hidden")}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-forest-900 text-forest-100 transition-transform lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
        aria-label="Main navigation"
      >
        <div className="flex h-16 items-center justify-between px-5">
          <Logo />
          <button type="button" onClick={onClose} className="rounded p-1 text-forest-200 hover:bg-white/10 lg:hidden" aria-label="Close menu">
            <X className="size-5" />
          </button>
        </div>
        <nav className="scrollbar-thin flex-1 overflow-y-auto px-3 py-2">
          {groups.map((group) => {
            const groupItems = items.filter((i) => i.group === group);
            if (groupItems.length === 0) return null;
            return (
              <div key={group} className="mb-4">
                <p className="px-3 pb-1.5 text-[10px] font-semibold tracking-[0.12em] text-forest-300/70 uppercase">{group}</p>
                <ul className="space-y-0.5">
                  {groupItems.map((item) => {
                    const isActive = item.key === active;
                    return (
                      <li key={item.key}>
                        <a
                          href={`#/${item.key}`}
                          onClick={() => {
                            onNavigate(item.key);
                            onClose();
                          }}
                          aria-current={isActive ? "page" : undefined}
                          className={cn(
                            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                            isActive ? "bg-white/10 font-medium text-white" : "text-forest-100/80 hover:bg-white/5 hover:text-white",
                          )}
                        >
                          <span className={cn("shrink-0", isActive ? "text-forest-300" : "text-forest-300/70")}>{item.icon}</span>
                          {item.label}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>
        {footer && <div className="border-t border-white/10 px-4 py-4">{footer}</div>}
      </aside>
    </>
  );
}
