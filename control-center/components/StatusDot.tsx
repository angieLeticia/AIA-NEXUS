import type { Severity } from "@/types/observability";

const COLORS: Record<Severity | "BLUE" | "GRAY", string> = {
  GREEN: "bg-status-green",
  WARNING: "bg-status-yellow",
  CRITICAL: "bg-status-red",
  BLUE: "bg-status-blue",
  GRAY: "bg-status-gray",
};

export function StatusDot({ severity, pulse = false }: { severity: Severity | "BLUE" | "GRAY"; pulse?: boolean }) {
  return (
    <span className="relative inline-flex h-2.5 w-2.5">
      {pulse && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${COLORS[severity]} opacity-60`} />}
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${COLORS[severity]}`} />
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const text = { GREEN: "text-status-green", WARNING: "text-status-yellow", CRITICAL: "text-status-red" }[severity];
  const bg = { GREEN: "bg-status-green/10", WARNING: "bg-status-yellow/10", CRITICAL: "bg-status-red/10" }[severity];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium ${text} ${bg}`}>
      <StatusDot severity={severity} />
      {severity}
    </span>
  );
}
