"use client";

import { useEffect, useState } from "react";
import { StatusDot } from "./StatusDot";
import type { SystemStatus } from "@/types/observability";

export function Header() {
  const [status, setStatus] = useState<SystemStatus>("OFFLINE");
  const [pauseAgentsPresent, setPauseAgentsPresent] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const [sysRes, incRes] = await Promise.all([fetch("/api/system"), fetch("/api/incidents")]);
        const sys = await sysRes.json();
        const inc = await incRes.json();
        if (cancelled) return;
        setPauseAgentsPresent(sys.pauseAgentsPresent);
        const hasCritical = inc.incidents?.some((i: { severity: string }) => i.severity === "CRITICAL");
        const hasWarning = inc.incidents?.some((i: { severity: string }) => i.severity === "WARNING");
        setStatus(sys.pauseAgentsPresent ? "DEGRADED" : hasCritical ? "CRITICAL" : hasWarning ? "WARNING" : "ONLINE");
      } catch {
        if (!cancelled) setStatus("OFFLINE");
      }
    };
    poll();
    const id = setInterval(poll, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const severity = status === "ONLINE" ? "GREEN" : status === "WARNING" || status === "DEGRADED" ? "WARNING" : status === "CRITICAL" ? "CRITICAL" : "GRAY";

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-bg-panel px-5">
      <span className="text-sm font-semibold tracking-wide text-white">AIA NEXUS CONTROL CENTER</span>
      <div className="flex items-center gap-4 text-xs">
        {pauseAgentsPresent === true && <span className="text-status-yellow">PAUSE_AGENTS ACTIVE</span>}
        <span className="flex items-center gap-2 text-gray-300">
          <StatusDot severity={severity} pulse={status === "ONLINE"} />
          SYSTEM {status}
        </span>
      </div>
    </header>
  );
}
