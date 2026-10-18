import { Ban, ClipboardList, Cpu, KeyRound, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { FIELD_PROFILES } from "@core/deviceSimulator.js";
import { explorerAddressUrl } from "@core/networks.js";
import { PageHeader } from "../components/layout/PageHeader";
import { RemixArgsModal } from "../components/RemixArgsModal";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Callout } from "../components/ui/Callout";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { Field, Input, Select } from "../components/ui/Field";
import { HashText } from "../components/ui/HashText";
import { ConfirmDialog } from "../components/ui/Modal";
import { InfoTip } from "../components/ui/Tooltip";
import { useLedger } from "../state/LedgerContext";
import { useSettings } from "../state/SettingsContext";
import { useSimulator } from "../state/SimulatorContext";
import { useToast } from "../state/ToastContext";
import type { DeviceInfo } from "../types/app";
import { formatDateTime } from "../utils/format";

function nextDeviceId(existing: string[]): string {
  for (let i = 1; i < 10_000; i++) {
    const id = `CL-DEV-${String(i).padStart(4, "0")}`;
    if (!existing.includes(id)) return id;
  }
  return "CL-DEV-NEW";
}

export function DeviceRegistryPage() {
  const { settings } = useSettings();
  const ledger = useLedger();
  const sim = useSimulator();
  const { notify } = useToast();
  const isLocal = settings.mode === "local";

  const takenIds = useMemo(
    () => [...ledger.devices.map((d) => d.label), ...ledger.deviceKeys.map((k) => k.label)],
    [ledger.devices, ledger.deviceKeys],
  );
  const [deviceId, setDeviceId] = useState("");
  const [fieldId, setFieldId] = useState("FIELD-A1");
  const [firmware, setFirmware] = useState("1.4.2");
  const [busy, setBusy] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<DeviceInfo | null>(null);
  const [remixDevice, setRemixDevice] = useState<{ label: string; fieldLabel: string; firmware: string; address: string } | null>(null);

  const suggestedId = nextDeviceId(takenIds);
  const effectiveId = deviceId || suggestedId;

  const register = async () => {
    setBusy(true);
    const result = await sim.createDevice(effectiveId, fieldId, firmware);
    setBusy(false);
    if (result.ok) {
      notify({ tone: "success", title: `${effectiveId} registered`, message: isLocal ? "Recorded in the local demo ledger." : `Confirmed in block ${result.blockNumber}.` });
      setDeviceId("");
    } else if (result.error) {
      notify({ tone: result.error.kind === "wallet-rejected" ? "warning" : "error", title: "Registration not completed", message: result.error.message });
    }
  };

  const revoke = async (device: DeviceInfo) => {
    setRevokeTarget(null);
    if (!ledger.service) return;
    const result = await ledger.runWrite({ kind: "revokeDevice", label: `Revoke ${device.label}`, deviceId: device.deviceId, deviceLabel: device.label }, (opts) =>
      ledger.service!.revokeDevice(device.deviceId, opts),
    );
    if (result.ok) notify({ tone: "success", title: `${device.label} revoked`, message: "New readings from it will be rejected. Its history stays retrievable." });
    else if (result.error) notify({ tone: "error", title: "Revocation not completed", message: result.error.message });
  };

  const unregisteredKeys = ledger.deviceKeys.filter((k) => !ledger.devices.some((d) => d.label === k.label));

  return (
    <>
      <PageHeader
        title="Device Registry"
        description="Only devices registered by the contract owner can submit readings. Each device signs with its own key; the contract stores its public signing address, field and firmware hash."
        actions={
          <Button variant="outline" icon={<RefreshCw className="size-4" />} onClick={() => void ledger.refresh()} loading={ledger.status === "loading"}>
            Refresh
          </Button>
        }
      />

      <Card className="mb-6">
        <CardHeader title="Register a simulated device" subtitle="Owner-only action" icon={<Plus className="size-4" />} />
        <CardBody className="space-y-3">
          <div className="grid items-start gap-4 md:grid-cols-[1fr_1.4fr_0.8fr_auto]">
            <Field label="Device ID" htmlFor="reg-id" hint="Stored on-chain as bytes32; never reusable.">
              <Input id="reg-id" value={deviceId} placeholder={suggestedId} onChange={(e) => setDeviceId(e.target.value.trim())} />
            </Field>
            <Field label="Field" htmlFor="reg-field" hint="Selects the soil profile the simulator uses.">
              <Select id="reg-field" value={fieldId} onChange={(e) => setFieldId(e.target.value)}>
                {Object.entries(FIELD_PROFILES).map(([id, profile]) => (
                  <option key={id} value={id}>
                    {id} — {profile.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Firmware version" htmlFor="reg-fw" hint="Its SHA-256 hash is recorded.">
              <Input id="reg-fw" value={firmware} onChange={(e) => setFirmware(e.target.value.trim())} />
            </Field>
            <div className="md:pt-[22px]">
              <Button
                className="w-full"
                icon={<KeyRound className="size-4" />}
                loading={busy}
                disabled={Boolean(ledger.ownerBlocker) || !ledger.service}
                disabledReason={ledger.ownerBlocker ?? "No ledger configured"}
                onClick={() => void register()}
              >
                Generate key &amp; register
              </Button>
            </div>
          </div>
          {ledger.ownerBlocker && <p className="text-xs text-soil-700">{ledger.ownerBlocker}</p>}
          <p className="text-xs leading-relaxed text-ink-faint">
            A new signing key is generated in this browser for the simulated device. Only its public address is sent to the
            {isLocal ? " local demo ledger" : " contract (MetaMask will ask you to approve the transaction)"}.
          </p>
        </CardBody>
      </Card>

        <Card>
          <CardHeader
            title="Registered devices"
            subtitle={`${ledger.devices.length} on ${isLocal ? "the local demo ledger" : "the contract"}`}
            icon={<Cpu className="size-4" />}
            actions={
              ledger.owner && (
                <span className="flex items-center gap-1.5 text-xs text-ink-muted">
                  <ShieldCheck className="size-3.5" /> Owner:{" "}
                  {isLocal ? "local operator" : <HashText value={ledger.owner} chars={4} href={explorerAddressUrl(settings.chainId, ledger.owner)} />}
                </span>
              )
            }
          />
          {ledger.devices.length === 0 ? (
            <EmptyState icon={<Cpu className="size-5" />} title="No devices registered">
              Register a simulated device to start recording readings.
            </EmptyState>
          ) : (
            <div className="scrollbar-thin overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-ink-muted">
                    <th className="px-5 py-2.5 font-medium">Device</th>
                    <th className="px-3 py-2.5 font-medium">Signer</th>
                    <th className="px-3 py-2.5 font-medium">
                      Firmware hash <InfoTip>SHA-256 of the approved firmware image recorded at registration (simulated).</InfoTip>
                    </th>
                    <th className="px-3 py-2.5 text-right font-medium">Nonce</th>
                    <th className="px-3 py-2.5 text-right font-medium">Readings</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-5 py-2.5 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {ledger.devices.map((d) => {
                    const key = ledger.deviceKeys.find((k) => k.label === d.label && k.address.toLowerCase() === d.signer.toLowerCase());
                    return (
                      <tr key={d.deviceId} className="align-middle">
                        <td className="px-5 py-3">
                          <p className="font-medium">{d.label}</p>
                          <p className="text-xs text-ink-faint">
                            {d.fieldLabel} · since {formatDateTime(d.registeredAt)}
                          </p>
                        </td>
                        <td className="px-3 py-3">
                          <HashText value={d.signer} chars={4} />
                          <div className="mt-0.5">
                            {key ? <Badge tone="success">key in this browser</Badge> : <Badge title="This browser cannot sign for this device">no local key</Badge>}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <HashText value={d.firmwareHash} chars={4} />
                        </td>
                        <td className="tabular px-3 py-3 text-right">{d.lastNonce.toString()}</td>
                        <td className="tabular px-3 py-3 text-right">{d.readingCount}</td>
                        <td className="px-3 py-3">
                          {d.active ? (
                            <Badge tone="success" dot>Active</Badge>
                          ) : (
                            <Badge tone="danger" dot title={`Revoked ${formatDateTime(d.revokedAt)}`}>Revoked</Badge>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex justify-end gap-1.5">
                            {key && (
                              <Button size="sm" variant="ghost" icon={<ClipboardList className="size-3.5" />} onClick={() => setRemixDevice({ ...key, address: d.signer })} title="Show registerDevice arguments for Remix">
                                Remix args
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              icon={<Ban className="size-3.5" />}
                              disabled={!d.active || Boolean(ledger.ownerBlocker)}
                              disabledReason={!d.active ? "Already revoked" : (ledger.ownerBlocker ?? undefined)}
                              onClick={() => setRevokeTarget(d)}
                            >
                              Revoke
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

      {unregisteredKeys.length > 0 && (
        <Card className="mt-6">
          <CardHeader
            title="Device keys not registered on this ledger"
            subtitle="Keys created in this browser that this ledger does not know (e.g. created for another deployment). Readings signed with them are rejected as unregistered."
            icon={<KeyRound className="size-4" />}
          />
          <CardBody className="flex flex-wrap gap-2">
            {unregisteredKeys.map((k) => (
              <span key={k.label} className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-xs">
                <span className="font-medium">{k.label}</span>
                <span className="text-ink-faint">{k.fieldLabel}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={Boolean(ledger.ownerBlocker)}
                  disabledReason={ledger.ownerBlocker ?? undefined}
                  onClick={async () => {
                    const r = await sim.createDevice(k.label, k.fieldLabel, k.firmware);
                    if (!r.ok && r.error) notify({ tone: "error", title: "Registration not completed", message: r.error.message });
                  }}
                >
                  Register
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRemixDevice(k)}>
                  Remix args
                </Button>
              </span>
            ))}
          </CardBody>
        </Card>
      )}

      {!isLocal && (
        <Callout tone="info" className="mt-6" title="Registering from Remix instead">
          You can also call <span className="font-mono">registerDevice</span> directly in Remix. Use “Remix args” to copy the exact bytes32 values and the
          device's public address; the dashboard will pick the device up on the next refresh.
        </Callout>
      )}

      <ConfirmDialog
        open={revokeTarget !== null}
        title={`Revoke ${revokeTarget?.label}?`}
        confirmLabel="Revoke device"
        danger
        onCancel={() => setRevokeTarget(null)}
        onConfirm={() => revokeTarget && void revoke(revokeTarget)}
      >
        <p>
          Revocation is <strong>permanent</strong>: the contract will reject every future reading from this device, and its ID can never be registered
          again. Readings already recorded remain retrievable and verifiable.
        </p>
        {!isLocal && <p className="mt-2 text-ink-muted">MetaMask will ask you to approve the transaction.</p>}
      </ConfirmDialog>

      <RemixArgsModal open={remixDevice !== null} device={remixDevice} onClose={() => setRemixDevice(null)} />
    </>
  );
}
