import { AlertTriangle, Ban, BrainCircuit, CheckCircle2, Clock3, Eye, RefreshCcw, ShieldAlert, UserCheck } from "lucide-react";

export function StatusPill({ value }: { value: string }) {
  const kind = value.toUpperCase();
  const className = kind.toLowerCase().replaceAll("_", "-").replaceAll(" ", "-");
  const Icon = kind.includes("BOUND")
    ? BrainCircuit
    : kind.includes("HUMAN")
      ? UserCheck
    : kind.includes("TTL")
        ? Clock3
        : kind.includes("ALLOW") || kind === "ACTIVE" || kind === "VALID" || kind === "VERIFIED"
    ? CheckCircle2
    : kind.includes("BLOCK") || kind.includes("REVOK") || kind.includes("INVALID")
      ? Ban
      : kind.includes("REVIEW") || kind === "PENDING"
        ? Eye
        : kind.includes("REDACT")
          ? RefreshCcw
          : kind.includes("HIGH") || kind.includes("CRITICAL")
            ? ShieldAlert
            : AlertTriangle;
  return (
    <span className={`pill pill-${className}`}>
      <Icon size={13} aria-hidden="true" />
      {value.replaceAll("_", " ")}
    </span>
  );
}
