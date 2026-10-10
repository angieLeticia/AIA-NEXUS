"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/Card";
import type { AgentRole, LiveEvent } from "@/types/observability";

const ROLES: { value: AgentRole | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "agent1", label: "Agent 1" },
  { value: "agent2", label: "Agent 2" },
  { value: "watcher", label: "Watcher" },
  { value: "scheduler", label: "Scheduler" },
  { value: "publisher", label: "Publisher" },
];

export default function LogsPage() {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [paused, setPaused] = useState(false);
  const [autoscroll, setAutoscroll] = useState(true);
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState<"all" | "GREEN" | "WARNING" | "CRITICAL">("all");
  const buffer = useRef<LiveEvent[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const source = new EventSource("/api/events");
    source.onmessage = (e) => {
      try {
        const parsed: LiveEvent = JSON.parse(e.data);
        buffer.current = [...buffer.current, parsed].slice(-2000);
        if (!paused) setEvents(buffer.current);
      } catch {
        // keep-alive comment frames land here and are ignored
      }
    };
    return () => source.close();
  }, [paused]);

  useEffect(() => {
    if (autoscroll && !paused) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events, autoscroll, paused]);

  const filtered = useMemo(() => {
    return events.filter((e) => {
      if (severityFilter !== "all" && e.severity !== severityFilter) return false;
      if (search && !e.message.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [events, severityFilter, search]);

  const copyAll = async () => {
    await navigator.clipboard.writeText(filtered.map((e) => `[${e.timestamp}] [${e.component}] ${e.message}`).join("\n"));
  };

  return (
    <div className="flex h-full flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search message…"
            className="mono min-w-[200px] flex-1 rounded border border-border bg-bg-raised px-3 py-1.5 text-sm text-gray-200 outline-none focus:border-status-blue"
          />
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value as typeof severityFilter)}
            className="rounded border border-border bg-bg-raised px-2 py-1.5 text-sm text-gray-200"
          >
            <option value="all">All severities</option>
            <option value="GREEN">Info</option>
            <option value="WARNING">Warning</option>
            <option value="CRITICAL">Error/Critical</option>
          </select>
          <button
            onClick={() => setPaused((p) => !p)}
            className={`rounded px-3 py-1.5 text-sm ${paused ? "bg-status-yellow/20 text-status-yellow" : "bg-bg-raised text-gray-300"}`}
          >
            {paused ? "Resume" : "Pause"}
          </button>
          <button
            onClick={() => setAutoscroll((a) => !a)}
            className={`rounded px-3 py-1.5 text-sm ${autoscroll ? "bg-status-blue/20 text-status-blue" : "bg-bg-raised text-gray-300"}`}
          >
            Autoscroll: {autoscroll ? "On" : "Off"}
          </button>
          <button onClick={copyAll} className="rounded bg-bg-raised px-3 py-1.5 text-sm text-gray-300 hover:bg-bg-raised/70">
            Copy
          </button>
          <button
            onClick={() => {
              setEvents([]);
              buffer.current = [];
            }}
            className="rounded bg-bg-raised px-3 py-1.5 text-sm text-gray-300 hover:bg-bg-raised/70"
            title="Clears this view only — never deletes the real log files on disk."
          >
            Clear view
          </button>
        </div>
      </Card>

      <Card className="flex-1 overflow-hidden">
        <div className="mono h-full overflow-y-auto text-xs leading-relaxed">
          {filtered.map((e, i) => (
            <div key={i} className="flex gap-2 border-b border-border/40 py-1">
              <span className="shrink-0 text-gray-500">{e.timestamp}</span>
              <span
                className={`shrink-0 ${e.severity === "CRITICAL" ? "text-status-red" : e.severity === "WARNING" ? "text-status-yellow" : "text-status-blue"}`}
              >
                {e.component}
              </span>
              <span className="text-gray-300">{e.message}</span>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </Card>
    </div>
  );
}
