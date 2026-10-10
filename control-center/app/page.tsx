"use client";

import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/Card";
import { StatusDot, SeverityBadge } from "@/components/StatusDot";
import type { AgentStatus, LiveEvent, PipelineStageCounts, SystemResources } from "@/types/observability";

function Unavailable() {
  return <span className="text-gray-500">UNAVAILABLE</span>;
}

function useLiveEvents(max = 60) {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  useEffect(() => {
    const source = new EventSource("/api/events");
    source.onmessage = (e) => {
      try {
        const parsed: LiveEvent = JSON.parse(e.data);
        setEvents((prev) => [parsed, ...prev].slice(0, max));
      } catch {
        // ignore malformed/keep-alive frames
      }
    };
    return () => source.close();
  }, [max]);
  return events;
}

function usePoll<T>(url: string, intervalMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(String(res.status));
        const json = await res.json();
        if (!cancelled) {
          setData(json);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [url, intervalMs]);
  return { data, error };
}

export default function OverviewPage() {
  const { data: system } = usePoll<SystemResources & { nodeProcessCount: number; ffmpegProcessCount: number; ollamaRunning: boolean }>("/api/system", 5000);
  const { data: agentsData } = usePoll<{ agents: AgentStatus[] }>("/api/agents", 4000);
  const { data: pipeline } = usePoll<PipelineStageCounts>("/api/pipeline", 10000);
  const liveEvents = useLiveEvents();
  const feedRef = useRef<HTMLDivElement>(null);

  const agents = agentsData?.agents ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card title="Resources">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-gray-500">RAM</dt>
              <dd className="mono text-gray-200">
                {system ? `${system.ramUsedMb ?? "?"} / ${system.ramTotalMb ?? "?"} MB (${system.ramUsedPercent ?? "?"}%)` : <Unavailable />}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">CPU</dt>
              <dd className="mono text-gray-200">{system?.cpuPercent != null ? `${system.cpuPercent}%` : <Unavailable />}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Node processes</dt>
              <dd className="mono text-gray-200">{system?.nodeProcessCount ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-gray-500">FFmpeg processes</dt>
              <dd className="mono text-gray-200">{system?.ffmpegProcessCount ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Ollama</dt>
              <dd>
                {system ? (
                  <span className="flex items-center gap-1.5">
                    <StatusDot severity={system.ollamaRunning ? "GREEN" : "GRAY"} /> {system.ollamaRunning ? "running" : "not running"}
                  </span>
                ) : (
                  <Unavailable />
                )}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">PAUSE_AGENTS</dt>
              <dd className="flex items-center gap-1.5">
                <StatusDot severity={system?.pauseAgentsPresent ? "WARNING" : "GREEN"} />
                {system ? (system.pauseAgentsPresent ? "PRESENT" : "ABSENT") : <Unavailable />}
              </dd>
            </div>
          </dl>
        </Card>

        <Card title="Runtime">
          <dl className="grid grid-cols-1 gap-3 text-sm">
            <div>
              <dt className="text-gray-500">Last boot</dt>
              <dd className="mono text-gray-200">{system?.lastBootUpTime ?? <Unavailable />}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Approx. last logon</dt>
              <dd className="mono text-gray-200">{system?.approximateLastLogonTime ?? <Unavailable />}</dd>
              <p className="mt-0.5 text-[11px] text-gray-500">via explorer.exe start time — Security log unavailable without admin.</p>
            </div>
          </dl>
        </Card>

        <Card title="Pipeline">
          {pipeline ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {([
                ["Files", pipeline.files],
                ["Analyzing", pipeline.analyzing],
                ["Ready", pipeline.ready],
                ["Authorized", pipeline.authorized],
                ["Pending pub.", pipeline.pendingPublication],
                ["Published", pipeline.published],
                ["Errors", pipeline.errors],
              ] as const).map(([label, value]) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-gray-500">{label}</span>
                  <span className="mono text-gray-200">{value}</span>
                </div>
              ))}
            </div>
          ) : (
            <Unavailable />
          )}
        </Card>
      </div>

      <Card title="Agents">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {agents.map((a) => (
            <div key={a.role} className="rounded border border-border bg-bg-raised p-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-100">{a.label}</span>
                <StatusDot severity={a.status === "ACTIVE" ? "GREEN" : a.status === "ERROR" ? "CRITICAL" : a.status === "IDLE" ? "GRAY" : "WARNING"} pulse={a.status === "ACTIVE"} />
              </div>
              <div className="text-xs text-gray-400">{a.status}</div>
              {a.currentStage && <div className="mt-1 text-xs text-gray-500">{a.currentStage}</div>}
            </div>
          ))}
          {agents.length === 0 && <Unavailable />}
        </div>
      </Card>

      <Card title="Live Activity">
        <div ref={feedRef} className="mono max-h-80 overflow-y-auto text-xs leading-relaxed">
          {liveEvents.length === 0 && <p className="text-gray-500">Waiting for events…</p>}
          {liveEvents.map((e, i) => (
            <div key={i} className="flex gap-2 border-b border-border/50 py-1">
              <span className="shrink-0 text-gray-500">{e.timestamp.slice(11, 19)}</span>
              <span className="shrink-0 text-status-blue">{e.component}</span>
              <span className="truncate text-gray-300">{e.message}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
