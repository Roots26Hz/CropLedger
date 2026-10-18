import { FileCheck2, ShieldAlert } from "lucide-react";
import { PageHeader } from "../components/layout/PageHeader";
import { Tabs } from "../components/ui/Tabs";
import { useRoute } from "../hooks/useRoute";
import { AttackLab } from "./lab/AttackLab";
import { IntegrityLab } from "./lab/IntegrityLab";

type LabTab = "integrity" | "attacks";

export function VerificationLabPage() {
  const { route, navigate } = useRoute();
  const tab: LabTab = route.params.get("tab") === "attacks" ? "attacks" : "integrity";

  return (
    <>
      <PageHeader
        title="Verification Lab"
        description="Prove that a stored reading is authentic, show that a single altered value is detected, and try the attacks the contract is designed to stop."
        actions={
          <Tabs<LabTab>
            items={[
              { key: "integrity", label: "Payload integrity", icon: <FileCheck2 className="size-4" /> },
              { key: "attacks", label: "Attack scenarios", icon: <ShieldAlert className="size-4" /> },
            ]}
            active={tab}
            onChange={(next) => {
              const params: Record<string, string> = {};
              route.params.forEach((value, key) => {
                params[key] = value;
              });
              navigate("lab", { ...params, tab: next === "attacks" ? "attacks" : undefined });
            }}
          />
        }
      />
      {tab === "integrity" ? <IntegrityLab /> : <AttackLab />}
    </>
  );
}
