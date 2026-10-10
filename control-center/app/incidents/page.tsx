"use client";

import { useState } from "react";
import { Card } from "@/components/Card";
import { SeverityBadge } from "@/components/StatusDot";
import { usePoll } from "@/lib/hooks/usePoll";
import type { Incident } from "@/types/observability";

export default function IncidentsPage() {
  const { data } = usePoll<{ incidents: Incident[] }>("/api/incidents", 10000);
  const incidents = data?.incidents ?? [];
  const [expanded, setExpanded] = useState<string | null>(null);

  const counts = {
    CRITICAL: incidents.filter((i) => i.severity === "CRITICAL").length,
    WARNING: incidents.filter((i) => i.severity === "WARNING").length,
    GREEN: incidents.filter((i) => i.severity === "GREEN").length,
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-3">
        <Card className="flex-1 text-center">
          <span className="text-2xl font-semibold text-status-red">{counts.CRITICAL}</span>
          <p className="text-xs text-gray-500">Critical</p>
        </Card>
        <Card className="flex-1 text-center">
          <span className="text-2xl font-semibold text-status-yellow">{counts.WARNING}</span>
          <p className="text-xs text-gray-500">Warning</p>
        </Card>
        <Card className="flex-1 text-center">
          <span className="text-2xl font-semibold text-status-green">{counts.GREEN}</span>
          <p className="text-xs text-gray-500">Informational</p>
        </Card>
      </div>

      <Card title="Incidents">
        {incidents.length === 0 && <p className="text-sm text-gray-500">No incidents detected.</p>}
        <div className="flex flex-col divide-y divide-border/50">
          {incidents.map((inc) => (
            <div key={inc.id} className="py-3">
              <button onClick={() => setExpanded(expanded === inc.id ? null : inc.id)} className="flex w-full items-center justify-between text-left">
                <div className="flex items-center gap-3">
                  <SeverityBadge severity={inc.severity} />
                  <span className="text-sm text-gray-100">{inc.title}</span>
                </div>
                <span className="text-xs text-gray-500">{expanded === inc.id ? "▾" : "▸"}</span>
              </button>
              {expanded === inc.id && (
                <div className="mt-2 rounded border border-border bg-bg-raised p-3 text-xs">
                  <p className="text-gray-300">{inc.detail}</p>
                  <p className="mt-2 mono text-gray-500">type: {inc.type}</p>
                  <p className="mono text-gray-500">detected: {inc.detectedAt}</p>
                  <pre className="mono mt-2 overflow-x-auto text-gray-400">{JSON.stringify(inc.evidence, null, 2)}</pre>
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
