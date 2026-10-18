/**
 * Adversarial scenarios run against the active ledger. Each attempt is a real
 * call: in network mode it is preflighted with eth_call (no gas) and, only if
 * the user opts in, broadcast to record an on-chain failed transaction.
 */
import { Ban, Copy, PlayCircle, ShieldAlert, UserX, Wand2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Wallet } from "ethers";
import { EdgeDeviceSimulator } from "@core/deviceSimulator.js";
import { firmwareHashFor, toBytes32Id } from "@core/ids.js";
import { explorerTxUrl } from "@core/networks.js";
import { signedReadingFromJson, signedReadingToJson } from "@core/serialization.js";
import { signReading, toSubmitArgs } from "@core/signing.js";
import { StageBadge } from "../../components/StageBadge";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Callout } from "../../components/ui/Callout";
import { Card, CardBody, CardHeader } from "../../components/ui/Card";
import { HashText } from "../../components/ui/HashText";
import type { LedgerResult } from "../../services/ledger/types";
import { useLedger } from "../../state/LedgerContext";
import { useSettings } from "../../state/SettingsContext";
import { useSimulator } from "../../state/SimulatorContext";

type ScenarioKey = "replay" | "unregistered" | "forged" | "revoked";

interface Outcome {
  running: boolean;
  log: string[];
  result?: LedgerResult;
  /** True when the outcome matches the expected protection. */
  asExpected?: boolean;
}

const SCENARIOS: { key: ScenarioKey; title: string; icon: ReactNode; what: string; expected: string; expectedError: string }[] = [
  {
    key: "replay",
    title: "Replay attack",
    icon: <Copy className="size-4" />,
    what: "Resubmit a reading that is already recorded — same signature, same nonce — to double-count it.",
    expected: "Rejected with StaleNonce: each nonce is accepted once.",
    expectedError: "StaleNonce",
  },
  {
    key: "unregistered",
    title: "Unregistered device",
    icon: <UserX className="size-4" />,
    what: "A rogue sensor that was never registered signs a perfectly well-formed reading.",
    expected: "Rejected with UnknownDevice.",
    expectedError: "UnknownDevice",
  },
  {
    key: "forged",
    title: "Gateway forgery",
    icon: <Wand2 className="size-4" />,
    what: "The gateway raises N by 40 mg/kg after the device signed, keeping the original signature.",
    expected: "Rejected with InvalidSignature: the signature covers every value.",
    expectedError: "InvalidSignature",
  },
  {
    key: "revoked",
    title: "Revoked device",
    icon: <Ban className="size-4" />,
    what: "Register a throw-away device, record one reading, revoke the device, then try to submit again.",
    expected: "Rejected with DeviceNotActive; the earlier reading stays retrievable and verifiable.",
    expectedError: "DeviceNotActive",
  },
];

export function AttackLab() {
  const { settings } = useSettings();
  const ledger = useLedger();
  const sim = useSimulator();
  const [broadcast, setBroadcast] = useState(false);
  const [outcomes, setOutcomes] = useState<Partial<Record<ScenarioKey, Outcome>>>({});
  const isLocal = settings.mode === "local";
  const service = ledger.service;

  const replayCandidate = sim.feed.find((f) => f.txId && ledger.txs.find((t) => t.id === f.txId)?.stage === "confirmed");
  const forgerDevice = sim.devices.find((d) => d.registered && d.active);

  const blockers: Record<ScenarioKey, string | null> = {
    replay: ledger.writeBlocker ?? (replayCandidate ? null : "Record at least one reading from the Live Sensor Feed first."),
    unregistered: ledger.writeBlocker,
    forged: ledger.writeBlocker ?? (forgerDevice ? null : "Needs a registered, active device with a key in this browser."),
    revoked: ledger.ownerBlocker,
  };

  const update = (key: ScenarioKey, patch: Partial<Outcome>) =>
    setOutcomes((all) => ({ ...all, [key]: { running: false, log: [], ...all[key], ...patch } }));
  const log = (key: ScenarioKey, line: string) =>
    setOutcomes((all) => ({ ...all, [key]: { running: true, ...all[key], log: [...(all[key]?.log ?? []), line] } }));

  const finish = (key: ScenarioKey, result: LedgerResult, expectedError: string) =>
    update(key, { running: false, result, asExpected: !result.ok && result.error?.name === expectedError });

  const run = async (key: ScenarioKey) => {
    if (!service) return;
    const scenario = SCENARIOS.find((s) => s.key === key)!;
    setOutcomes((all) => ({ ...all, [key]: { running: true, log: [] } }));
    const forceBroadcast = !isLocal && broadcast;
    try {
      if (key === "replay" && replayCandidate) {
        const signed = signedReadingFromJson(replayCandidate.signed);
        log(key, `Re-sending ${replayCandidate.deviceLabel} nonce ${replayCandidate.payload.nonce} (already recorded).`);
        const result = await ledger.runWrite(
          { kind: "attack", label: `Replay attack: ${replayCandidate.deviceLabel} nonce ${replayCandidate.payload.nonce}`, deviceId: signed.message.deviceId, deviceLabel: replayCandidate.deviceLabel },
          (opts) => service.submitReading(signed, { ...opts, forceBroadcast }),
        );
        finish(key, result, scenario.expectedError);
      } else if (key === "unregistered") {
        const rogue = Wallet.createRandom();
        const label = `ROGUE-${rogue.address.slice(2, 6).toUpperCase()}`;
        const payload = new EdgeDeviceSimulator({ deviceId: label, fieldId: "FIELD-A1", firmware: "6.6.6" }).generate().payload;
        const signed = await signReading(rogue, service.domain, payload);
        log(key, `${label} (never registered) signed a valid reading with key ${rogue.address.slice(0, 10)}…`);
        const result = await ledger.runWrite({ kind: "attack", label: `Unregistered device ${label}`, deviceId: signed.message.deviceId, deviceLabel: label }, (opts) =>
          service.submitReading(signed, { ...opts, forceBroadcast }),
        );
        finish(key, result, scenario.expectedError);
      } else if (key === "forged" && forgerDevice) {
        const payload = sim.nextPayload(forgerDevice.label);
        const signed = await sim.signWith(forgerDevice.label, payload);
        const [id, reading, nonce, signature] = toSubmitArgs(signed);
        const forged = { ...reading, n: reading.n + 40 };
        log(key, `${forgerDevice.label} signed N = ${reading.n}; gateway submits N = ${forged.n} with the same signature.`);
        const result = await ledger.runWrite({ kind: "attack", label: `Gateway forgery on ${forgerDevice.label} (N ${reading.n} → ${forged.n})`, deviceId: id, deviceLabel: forgerDevice.label }, (opts) =>
          service.submitRaw([id, forged, nonce, signature], { ...opts, forceBroadcast }),
        );
        finish(key, result, scenario.expectedError);
      } else if (key === "revoked") {
        const keyPair = Wallet.createRandom();
        const label = `REVOKE-DEMO-${keyPair.address.slice(2, 6).toUpperCase()}`;
        const deviceId = toBytes32Id(label);
        const deviceSim = new EdgeDeviceSimulator({ deviceId: label, fieldId: "FIELD-C3", firmware: "1.4.2" });
        ledger.addDeviceKey({ label, fieldLabel: "FIELD-C3", firmware: "1.4.2", address: keyPair.address, privateKey: keyPair.privateKey, createdAt: Date.now() });

        log(key, `1/4 Registering throw-away device ${label}…`);
        const reg = await ledger.runWrite({ kind: "registerDevice", label: `Register ${label} (revocation demo)`, deviceId, deviceLabel: label }, (opts) =>
          service.registerDevice(deviceId, keyPair.address, toBytes32Id("FIELD-C3"), firmwareHashFor("1.4.2"), opts),
        );
        if (!reg.ok) return update(key, { running: false, result: reg, asExpected: false });

        const first = await signReading(keyPair, service.domain, deviceSim.generate().payload);
        log(key, "2/4 Recording one genuine reading…");
        const sub = await ledger.runWrite({ kind: "submitReading", label: `Reading nonce 1 from ${label}`, deviceId, deviceLabel: label, nonce: 1 }, (opts) =>
          service.submitReading(first, opts),
        );
        if (!sub.ok) return update(key, { running: false, result: sub, asExpected: false });
        ledger.evidence.put(signedReadingToJson(first));

        log(key, "3/4 Owner revokes the device…");
        const rev = await ledger.runWrite({ kind: "revokeDevice", label: `Revoke ${label}`, deviceId, deviceLabel: label }, (opts) => service.revokeDevice(deviceId, opts));
        if (!rev.ok) return update(key, { running: false, result: rev, asExpected: false });

        log(key, "4/4 The revoked device tries to submit another reading…");
        const second = await signReading(keyPair, service.domain, deviceSim.generate().payload);
        const result = await ledger.runWrite({ kind: "attack", label: `Revoked device ${label} submits again`, deviceId, deviceLabel: label }, (opts) =>
          service.submitReading(second, { ...opts, forceBroadcast }),
        );
        const history = await service.getReadings(deviceId);
        const stillValid = history[0] ? await service.verifyReading(deviceId, 0, first.payloadHash) : false;
        log(key, `History check: ${history.length} reading(s) still retrievable; verifyReading(#0) = ${stillValid}.`);
        finish(key, result, scenario.expectedError);
      }
    } catch (e) {
      update(key, { running: false, log: [...(outcomes[key]?.log ?? []), `Unexpected error: ${(e as Error).message}`] });
    }
  };

  return (
    <div className="space-y-6">
      <Callout tone="info" title="Real rule checks, no hard-coded results">
        Each scenario sends a genuine request to the {isLocal ? "local demo ledger (same rules as the contract)" : "deployed contract"} and reports what it answered. In network
        mode the attempt is first simulated with <span className="font-mono">eth_call</span>, so a rejection costs no gas.
      </Callout>

      {!isLocal && (
        <label className="flex items-start gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-sm">
          <input type="checkbox" className="mt-1 size-4 accent-forest-600" checked={broadcast} onChange={(e) => setBroadcast(e.target.checked)} />
          <span>
            <span className="font-medium">Also broadcast rejected attempts</span>
            <span className="block text-[13px] text-ink-muted">
              Skips the free preflight and sends the transaction anyway, so the failure is recorded on-chain (status 0, visible on PolygonScan). Costs a small amount of test POL and needs
              MetaMask approval.
            </span>
          </span>
        </label>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {SCENARIOS.map((s) => {
          const outcome = outcomes[s.key];
          const blocker = blockers[s.key];
          const url = outcome?.result?.txHash && service?.chainId ? explorerTxUrl(service.chainId, outcome.result.txHash) : undefined;
          return (
            <Card key={s.key}>
              <CardHeader
                title={s.title}
                icon={s.icon}
                actions={
                  <Button size="sm" icon={<PlayCircle className="size-4" />} loading={outcome?.running} disabled={Boolean(blocker)} disabledReason={blocker ?? undefined} onClick={() => void run(s.key)}>
                    Run
                  </Button>
                }
              />
              <CardBody className="space-y-3 text-sm">
                <p className="text-ink-muted">{s.what}</p>
                <p className="text-[13px]">
                  <span className="font-medium">Expected:</span> {s.expected}
                </p>
                {blocker && <p className="text-xs text-soil-700">{blocker}</p>}
                {outcome && (
                  <div className="space-y-2 rounded-lg border border-line bg-surface-2 p-3">
                    {outcome.log.map((line, i) => (
                      <p key={i} className="text-xs text-ink-muted">
                        {line}
                      </p>
                    ))}
                    {outcome.result && (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <StageBadge stage={outcome.result.stage} local={isLocal} />
                        {outcome.result.error?.name && <Badge tone="neutral">{outcome.result.error.name}</Badge>}
                        {outcome.asExpected !== undefined &&
                          (outcome.asExpected ? (
                            <Badge tone="success" icon={<ShieldAlert className="size-3" />}>
                              blocked as expected
                            </Badge>
                          ) : (
                            <Badge tone="warning">unexpected outcome</Badge>
                          ))}
                      </div>
                    )}
                    {outcome.result?.error && <p className="text-xs text-danger-600">{outcome.result.error.message}</p>}
                    {outcome.result?.txHash && (
                      <p className="text-xs">
                        On-chain transaction: <HashText value={outcome.result.txHash} href={url} />
                      </p>
                    )}
                  </div>
                )}
              </CardBody>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
