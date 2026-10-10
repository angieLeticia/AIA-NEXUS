"use client";

import { useEffect, useState } from "react";
import { Card, InferredTag } from "@/components/Card";
import { StatusDot } from "@/components/StatusDot";
import type { AgentStatus } from "@/types/observability";

function usePoll<T>(url: string, intervalMs: number) {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(url);
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch {
        // keep last known value on transient failure
      }
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [url, intervalMs]);
  return data;
}

export default function AgentsPage() {
  const data = usePoll<{ agents: AgentStatus[] }>("/api/agents", 3000);
  const agents = data?.agents ?? [];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {agents.map((a) => (
        <Card key={a.role}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-white">{a.label}</h2>
            <span className="flex items-center gap-2 text-sm">
              <StatusDot
                severity={
                  a.status === "ACTIVE"
                    ? "GREEN"
                    : a.status === "ERROR"
                      ? "CRITICAL"
                      : a.status === "IDLE"
                        ? "GRAY"
                        // P2.12J — PAUSED es un hecho estructural (PAUSE_AGENTS/
                        // PAUSE_<ROL> presente), no una alarma: color calmo,
                        // distinto de ERROR/STALE_LOCK (quedan en WARNING, el
                        // default de abajo).
                        : a.status === "PAUSED"
                          ? "BLUE"
                          : "WARNING"
                }
                pulse={a.status === "ACTIVE"}
              />
              {a.status}
            </span>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div>
              <dt className="text-gray-500">Script</dt>
              <dd className="mono text-xs text-gray-300">{a.entrypoint}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Windows Task</dt>
              <dd className="mono text-xs text-gray-300">{a.taskName}</dd>
            </div>
            {a.processes.map((p, i) => (
              <div key={p.pid}>
                <dt className="text-gray-500">{i === 0 ? "Wrapper PID" : "Loader PID"}</dt>
                <dd className="mono text-xs text-gray-300">
                  {p.pid} {p.startTime && `· ${p.startTime}`}
                </dd>
              </div>
            ))}
            {a.processes.length === 0 && (
              <div className="col-span-2">
                <dt className="text-gray-500">Processes</dt>
                <dd className="text-xs text-gray-500">none running</dd>
              </div>
            )}
            <div>
              <dt className="text-gray-500">Last log activity</dt>
              <dd className="mono text-xs text-gray-300">{a.lastLogActivityAt ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Current stage</dt>
              <dd className="flex items-center text-xs text-gray-300">
                {a.currentStage ?? "UNKNOWN"}
                {a.currentStage && <InferredTag />}
              </dd>
            </div>
            {a.currentFile && (
              <div className="col-span-2">
                <dt className="text-gray-500">Current file</dt>
                <dd className="flex items-center text-xs text-gray-300">
                  <span className="mono truncate">{a.currentFile}</span>
                  <InferredTag />
                </dd>
              </div>
            )}
            {(a.currentAccount || a.currentEpisode) && (
              <div className="col-span-2 flex gap-6">
                {a.currentAccount && (
                  <div>
                    <dt className="text-gray-500">Account</dt>
                    <dd className="text-xs text-gray-300">{a.currentAccount}</dd>
                  </div>
                )}
                {a.currentEpisode && (
                  <div>
                    <dt className="text-gray-500">Episode</dt>
                    <dd className="text-xs text-gray-300">{a.currentEpisode}</dd>
                  </div>
                )}
              </div>
            )}
            {a.role === "agent1" && (
              <div className="col-span-2 rounded border border-border bg-bg-raised/50 p-2">
                <p className="text-xs text-gray-500">
                  Whisper progress: <span className="text-gray-400">UNKNOWN</span> — Whisper does not report a percentage; never simulated.
                </p>
              </div>
            )}
            {a.idleReason && (
              <div className="col-span-2 rounded border border-border bg-bg-raised/50 p-2">
                <p className="text-xs text-gray-500">
                  Reason: <span className="text-gray-400">{a.idleReason}</span>
                </p>
              </div>
            )}
            {a.lock && (
              <div className="col-span-2 rounded border border-border bg-bg-raised/50 p-2">
                <p className="text-xs text-gray-500">
                  Lock: PID {a.lock.pid}, started {a.lock.startedAt} —{" "}
                  <span className={a.lock.processAlive ? "text-status-green" : "text-status-red"}>
                    {a.lock.processAlive ? "process alive" : "STALE — process not running"}
                  </span>
                </p>
              </div>
            )}
          </dl>
        </Card>
      ))}
      {agents.length === 0 && <Card>Loading…</Card>}
    </div>
  );
}
