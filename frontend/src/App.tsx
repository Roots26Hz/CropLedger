import { LayoutDashboard, Menu } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "./components/layout/PageHeader";
import { Sidebar, type NavItem } from "./components/layout/Sidebar";
import { Badge } from "./components/ui/Badge";
import { Card, CardBody, CardHeader } from "./components/ui/Card";
import { ENV, maskRpcUrl } from "./config/env";
import { useHashRoute } from "./hooks/useHashRoute";

const NAV: NavItem[] = [{ key: "overview", label: "Overview", icon: <LayoutDashboard className="size-4" />, group: "Monitor" }];

export function App() {
  const { route, navigate } = useHashRoute();
  const [menuOpen, setMenuOpen] = useState(false);
  const configured = Boolean(ENV.chainId && ENV.contractAddress);

  return (
    <div className="min-h-screen">
      <Sidebar items={NAV} active={route.path} onNavigate={(k) => navigate(k)} open={menuOpen} onClose={() => setMenuOpen(false)} />
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-paper/90 px-4 backdrop-blur sm:px-6">
          <button type="button" className="rounded p-1.5 hover:bg-black/5 lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <Badge tone={configured ? "info" : "local"} dot>
            {configured ? "Network configuration detected" : "Local demonstration mode"}
          </Badge>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
          <PageHeader title="Overview" description="CropLedger dashboard scaffold." />
          <Card>
            <CardHeader title="Configuration" subtitle="Values read from the public VITE_* environment variables." />
            <CardBody className="space-y-1 text-sm">
              <p>Chain ID: {ENV.chainId ?? "not set"}</p>
              <p>Contract: {ENV.contractAddress ?? "not set"}</p>
              <p>RPC: {ENV.rpcUrl ? maskRpcUrl(ENV.rpcUrl) : "not set"}</p>
            </CardBody>
          </Card>
        </main>
      </div>
    </div>
  );
}
