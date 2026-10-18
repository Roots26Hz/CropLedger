import { firmwareHashFor, toBytes32Id } from "@core/ids.js";
import { CopyButton } from "./ui/HashText";
import { Modal } from "./ui/Modal";

function ArgRow({ name, value, note }: { name: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-semibold text-ink">{name}</span>
        <CopyButton value={value} label={`Copy ${name}`} />
      </div>
      <p className="mt-1 font-mono text-[12px] break-all text-ink-muted">{value}</p>
      {note && <p className="mt-1 text-[11px] text-ink-faint">{note}</p>}
    </div>
  );
}

/** Arguments for calling registerDevice manually in Remix's Deploy & Run panel. */
export function RemixArgsModal({
  open,
  onClose,
  device,
}: {
  open: boolean;
  onClose: () => void;
  device: { label: string; fieldLabel: string; firmware: string; address: string } | null;
}) {
  return (
    <Modal open={open} onClose={onClose} title="registerDevice arguments for Remix">
      {device && (
        <div className="space-y-3">
          <p className="text-[13px] text-ink-muted">
            In Remix → Deploy &amp; Run Transactions → Deployed Contracts, expand <span className="font-mono">registerDevice</span>, paste each value
            and click <strong>transact</strong> from the owner account. Only public values are shown; the device's private key never leaves this browser.
          </p>
          <ArgRow name="deviceId (bytes32)" value={toBytes32Id(device.label)} note={`"${device.label}" encoded with ethers.encodeBytes32String`} />
          <ArgRow name="signer (address)" value={device.address} note="Public address of the simulated device key" />
          <ArgRow name="fieldId (bytes32)" value={toBytes32Id(device.fieldLabel)} note={`"${device.fieldLabel}"`} />
          <ArgRow name="firmwareHash (bytes32)" value={firmwareHashFor(device.firmware)} note={`SHA-256 of the simulated firmware ${device.firmware}`} />
        </div>
      )}
    </Modal>
  );
}
