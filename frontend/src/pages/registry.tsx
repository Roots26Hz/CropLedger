import { Cpu, LayoutDashboard, Radio, Settings2 } from "lucide-react";
import type { ComponentType } from "react";
import type { NavItem } from "../components/layout/Sidebar";
import { DeviceRegistryPage } from "./DeviceRegistryPage";
import { LiveFeedPage } from "./LiveFeedPage";
import { OverviewPage } from "./OverviewPage";
import { SystemConfigPage } from "./SystemConfigPage";

export interface PageDefinition extends NavItem {
  component: ComponentType;
}

export const PAGES: PageDefinition[] = [
  { key: "overview", label: "Overview", icon: <LayoutDashboard className="size-4" />, group: "Monitor", component: OverviewPage },
  { key: "feed", label: "Live Sensor Feed", icon: <Radio className="size-4" />, group: "Monitor", component: LiveFeedPage },
  { key: "devices", label: "Device Registry", icon: <Cpu className="size-4" />, group: "Monitor", component: DeviceRegistryPage },
  { key: "config", label: "System Configuration", icon: <Settings2 className="size-4" />, group: "System", component: SystemConfigPage },
];
