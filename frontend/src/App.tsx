import { useState } from "react";
import { ModeBanner } from "./components/layout/ModeBanner";
import { Sidebar } from "./components/layout/Sidebar";
import { TopBar } from "./components/layout/TopBar";
import { useHashRoute } from "./hooks/useHashRoute";
import { PAGES } from "./pages/registry";
import { LedgerProvider } from "./state/LedgerContext";
import { SettingsProvider, useSettings } from "./state/SettingsContext";
import { SimulatorProvider } from "./state/SimulatorContext";
import { ToastProvider } from "./state/ToastContext";
import { WalletProvider } from "./state/WalletContext";
import { RouteContext } from "./hooks/useRoute";
import { shortHex } from "./utils/format";

function SidebarFooter() {
  const { settings, networkConfigured } = useSettings();
  return (
    <div className="space-y-1 text-[11px] text-forest-200/80">
      <p className="font-medium text-forest-100">{settings.mode === "local" ? "Local demonstration" : "Network mode"}</p>
      {settings.mode === "network" && <p className="font-mono">{networkConfigured ? shortHex(settings.contractAddress, 6) : "contract not set"}</p>}
      <p className="text-forest-300/60">Integrity &amp; attribution, not sensor accuracy.</p>
    </div>
  );
}

function Shell() {
  const routing = useHashRoute();
  const { route, navigate } = routing;
  const [menuOpen, setMenuOpen] = useState(false);
  const page = PAGES.find((p) => p.key === route.path) ?? PAGES[0]!;
  const Page = page.component;

  return (
    <RouteContext.Provider value={routing}>
      <div className="min-h-screen">
        <Sidebar
          items={PAGES}
          active={page.key}
          onNavigate={(key) => navigate(key)}
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          footer={<SidebarFooter />}
        />
        <div className="lg:pl-64">
          <TopBar onMenu={() => setMenuOpen(true)} />
          <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
            {page.key !== "config" && <ModeBanner onConfigure={() => navigate("config")} />}
            <div key={page.key} className="animate-fade-in">
              <Page />
            </div>
          </main>
        </div>
      </div>
    </RouteContext.Provider>
  );
}

export function App() {
  return (
    <ToastProvider>
      <SettingsProvider>
        <WalletProvider>
          <LedgerProvider>
            <SimulatorProvider>
              <Shell />
            </SimulatorProvider>
          </LedgerProvider>
        </WalletProvider>
      </SettingsProvider>
    </ToastProvider>
  );
}
