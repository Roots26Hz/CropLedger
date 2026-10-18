import type { SubmissionStage } from "@core/gateway.js";
import { Badge, type Tone } from "./ui/Badge";

interface StageStyle {
  label: string;
  localLabel?: string;
  tone: Tone;
  pulse?: boolean;
  hint: string;
}

export const STAGES: Record<SubmissionStage, StageStyle> = {
  validating: { label: "Validating", tone: "neutral", pulse: true, hint: "Gateway is checking the payload, hash and signature format." },
  preflight: { label: "Preflight check", tone: "neutral", pulse: true, hint: "Simulating the call (eth_call) so a rejection costs no gas." },
  "awaiting-wallet": { label: "Awaiting wallet", tone: "warning", pulse: true, hint: "Approve or reject the transaction in MetaMask." },
  submitted: { label: "Pending", localLabel: "Queued (simulated)", tone: "info", pulse: true, hint: "Broadcast to the network; waiting to be included in a block." },
  confirmed: { label: "Confirmed", localLabel: "Recorded (local demo)", tone: "success", hint: "Included in a block and the receipt reports success." },
  "rejected-preflight": { label: "Rejected by contract", localLabel: "Rejected by rules", tone: "danger", hint: "The contract's rules rejected the call before anything was broadcast." },
  "wallet-rejected": { label: "Rejected in wallet", tone: "warning", hint: "You declined the request in MetaMask. Nothing was sent." },
  reverted: { label: "Reverted on-chain", tone: "danger", hint: "Mined in a block, but the contract reverted it (gas was spent)." },
  failed: { label: "Failed", tone: "danger", hint: "The operation could not be completed. See the error message." },
};

export const FAILURE_STAGES: SubmissionStage[] = ["rejected-preflight", "wallet-rejected", "reverted", "failed"];
export const PENDING_STAGES: SubmissionStage[] = ["validating", "preflight", "awaiting-wallet", "submitted"];

export function StageBadge({ stage, local }: { stage: SubmissionStage; local?: boolean }) {
  const style = STAGES[stage];
  return (
    <Badge tone={local && stage === "confirmed" ? "local" : style.tone} dot pulse={style.pulse} title={style.hint}>
      {(local && style.localLabel) || style.label}
    </Badge>
  );
}
