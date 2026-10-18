import { PageHeader } from "../components/layout/PageHeader";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { useLedger } from "../state/LedgerContext";

export function OverviewPage() {
  const { devices, totalReadings, status } = useLedger();
  return (
    <>
      <PageHeader title="Overview" description="Crop-field readings, device identities and on-chain evidence at a glance." />
      <Card>
        <CardHeader title="Ledger" subtitle={`Status: ${status}`} />
        <CardBody className="text-sm">
          {devices.length} registered device(s), {totalReadings} reading(s) recorded.
        </CardBody>
      </Card>
    </>
  );
}
