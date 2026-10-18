import { ArrowLeftRight, Cpu, FileSearch, FlaskConical, LayoutDashboard, Network, Radio, Settings2 } from "lucide-react";
import type { ComponentType } from "react";
import type { NavItem } from "../components/layout/Sidebar";
import { DeviceRegistryPage } from "./DeviceRegistryPage";
import { EvidenceExplorerPage } from "./EvidenceExplorerPage";
import { LiveFeedPage } from "./LiveFeedPage";
import { NetworkPage } from "./NetworkPage";
import { OverviewPage } from "./OverviewPage";
import { SystemConfigPage } from "./SystemConfigPage";
import { TransactionsPage } from "./TransactionsPage";
import { VerificationLabPage } from "./VerificationLabPage";

export interface PageDefinition extends NavItem {
  component: ComponentType;
}

export const PAGES: PageDefinition[] = [
  { key: "overview", label: "Overview", icon: <LayoutDashboard className="size-4" />, group: "Monitor", component: OverviewPage },
  { key: "feed", label: "Live Sensor Feed", icon: <Radio className="size-4" />, group: "Monitor", component: LiveFeedPage },
  { key: "devices", label: "Device Registry", icon: <Cpu className="size-4" />, group: "Monitor", component: DeviceRegistryPage },
  { key: "transactions", label: "Transactions", icon: <ArrowLeftRight className="size-4" />, group: "Evidence", component: TransactionsPage },
  { key: "evidence", label: "Evidence Explorer", icon: <FileSearch className="size-4" />, group: "Evidence", component: EvidenceExplorerPage },
  { key: "lab", label: "Verification Lab", icon: <FlaskConical className="size-4" />, group: "Evidence", component: VerificationLabPage },
  { key: "network", label: "Network & Consensus", icon: <Network className="size-4" />, group: "System", component: NetworkPage },
  { key: "config", label: "System Configuration", icon: <Settings2 className="size-4" />, group: "System", component: SystemConfigPage },
];
