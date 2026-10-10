"use client";

import { useState } from "react";
import { Card, EvidenceTag } from "@/components/Card";
import { StatusDot } from "@/components/StatusDot";
import type { TraceResult } from "@/types/observability";

const STATUS_SEVERITY = { DONE: "GREEN", IN_PROGRESS: "BLUE", PENDING: "GRAY", ERROR: "CRITICAL", UNKNOWN: "GRAY" } as const;

export default function TracePage() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<TraceResult | null>(null);
  const [loading, setLoading] = useState(false);

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/trace?q=${encodeURIComponent(query.trim())}`);
      setResult(await res.json());
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <Card title="Search">
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="filename, content_file_id, content_metadata_id, social_post_id, external_post_id…"
            className="mono flex-1 rounded border border-border bg-bg-raised px-3 py-2 text-sm text-gray-200 outline-none focus:border-status-blue"
          />
          <button onClick={search} className="rounded bg-status-blue/20 px-4 py-2 text-sm font-medium text-status-blue hover:bg-status-blue/30">
            {loading ? "Searching…" : "Trace"}
          </button>
        </div>
      </Card>

      {result && (
        <Card title={`Timeline for "${result.query}"`}>
          {result.matched.filePath && (
            <div className="mb-4 grid grid-cols-2 gap-2 rounded border border-border bg-bg-raised p-3 text-xs sm:grid-cols-4">
              <div>
                <span className="text-gray-500">Account</span>
                <p className="text-gray-200">{result.matched.account ?? "—"}</p>
              </div>
              <div>
                <span className="text-gray-500">Episode</span>
                <p className="text-gray-200">{result.matched.episode ?? "—"}</p>
              </div>
              <div className="col-span-2">
                <span className="text-gray-500">File</span>
                <p className="mono truncate text-gray-200">{result.matched.filePath}</p>
              </div>
            </div>
          )}

          <ol className="relative border-l border-border pl-5">
            {result.timeline.map((event, i) => (
              <li key={i} className="mb-5 last:mb-0">
                <span className="absolute -left-[5px] mt-1.5">
                  <StatusDot severity={STATUS_SEVERITY[event.status]} />
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-100">{event.stage}</span>
                  <EvidenceTag source={event.source} />
                </div>
                {event.timestamp && <p className="mono text-xs text-gray-500">{event.timestamp}</p>}
                {event.detail && <p className="mt-0.5 text-xs text-gray-400">{event.detail}</p>}
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}
