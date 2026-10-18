import { RefreshCw, Settings2 } from "lucide-react";
import { useLedger } from "../../state/LedgerContext";
import { useSettings } from "../../state/SettingsContext";
import { Button } from "../ui/Button";
import { Callout } from "../ui/Callout";

/** Persistent, honest statement of where the data on screen comes from. */
export function ModeBanner({ onConfigure }: { onConfigure: () => void }) {
  const { settings, networkConfigured } = useSettings();
  const { status, error, refresh } = useLedger();

  if (settings.mode === "local") {
    return (
      <Callout
        tone="warning"
        title="Local demonstration mode"
        className="mb-6"
        action={
          <Button size="sm" variant="outline" icon={<Settings2 className="size-3.5" />} onClick={onConfigure}>
            Use a blockchain
          </Button>
        }
      >
        Readings are signed and verified in this browser using the same rules as the smart contract, but{" "}
        <strong>nothing is sent to a blockchain</strong>: there are no transaction hashes, gas or explorer links, and
        block numbers are simulated.
      </Callout>
    );
  }

  if (!networkConfigured) {
    return (
      <Callout
        tone="warning"
        title="No contract configured"
        className="mb-6"
        action={
          <Button size="sm" variant="outline" icon={<Settings2 className="size-3.5" />} onClick={onConfigure}>
            Configure
          </Button>
        }
      >
        Network mode needs the address of your deployed CropLedger contract. Deploy it with Remix (see
        REMIX_DEPLOYMENT_GUIDE.md), then paste the address in System Configuration — or switch back to local demo mode.
      </Callout>
    );
  }

  if (status === "error" && error) {
    return (
      <Callout
        tone="danger"
        title="Cannot read the blockchain"
        className="mb-6"
        action={
          <Button size="sm" variant="outline" icon={<RefreshCw className="size-3.5" />} onClick={() => void refresh()}>
            Retry
          </Button>
        }
      >
        {error.message} Check the RPC URL and contract address in System Configuration. The app has not switched to
        local mode.
      </Callout>
    );
  }

  return null;
}
