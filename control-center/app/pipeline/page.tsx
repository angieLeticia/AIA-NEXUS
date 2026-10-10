"use client";

import { useState } from "react";
import { Card } from "@/components/Card";
import { usePoll } from "@/lib/hooks/usePoll";
import type { AccountSummary, PipelineStageCounts } from "@/types/observability";

const STAGES: { key: keyof PipelineStageCounts; label: string }[] = [
  { key: "files", label: "Files" },
  { key: "analyzing", label: "Analyzing" },
  { key: "ready", label: "Ready" },
  { key: "authorized", label: "Authorized" },
  { key: "producing", label: "Producing" },
  { key: "produced", label: "Produced" },
  { key: "pendingPublication", label: "Pending Publication" },
  { key: "published", label: "Published" },
];

export default function PipelinePage() {
  const { data } = usePoll<{ stageCounts: PipelineStageCounts; accounts: AccountSummary[] }>("/api/pipeline", 10000);
  const [accountFilter, setAccountFilter] = useState<string>("all");

  const accounts = data?.accounts ?? [];
  const filtered = accountFilter === "all" ? accounts : accounts.filter((a) => a.account === accountFilter);

  return (
    <div className="flex flex-col gap-5">
      <Card title="Pipeline funnel">
        {data ? (
          <div className="flex flex-wrap items-stretch gap-2">
            {STAGES.map((s, i) => (
              <div key={s.key} className="flex items-center gap-2">
                <div className="flex min-w-[110px] flex-col items-center rounded border border-border bg-bg-raised px-4 py-3">
                  <span className="text-2xl font-semibold text-white">{data.stageCounts[s.key]}</span>
                  <span className="mt-1 text-[11px] uppercase tracking-wide text-gray-500">{s.label}</span>
                </div>
                {i < STAGES.length - 1 && <span className="text-gray-600">→</span>}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500">Loading…</p>
        )}
        <p className="mt-3 text-xs text-gray-500">
          Note: &quot;Producing&quot; / &quot;Produced&quot; are not yet derived from a dedicated Supabase status in this view — see{" "}
          <code className="mono">/pipeline/state/projects/*.json</code> manifests on the Accounts page for real per-episode production state.
        </p>
      </Card>

      <Card title="By account">
        <div className="mb-3 flex gap-2">
          <select
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value)}
            className="rounded border border-border bg-bg-raised px-2 py-1 text-sm text-gray-200"
          >
            <option value="all">All accounts</option>
            {accounts.map((a) => (
              <option key={a.account} value={a.account}>
                {a.account}
              </option>
            ))}
          </select>
        </div>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-gray-500">
              <th className="pb-2">Account</th>
              <th className="pb-2">Ready</th>
              <th className="pb-2">Processing</th>
              <th className="pb-2">Pending</th>
              <th className="pb-2">Authorized</th>
              <th className="pb-2">Published</th>
              <th className="pb-2">Error</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => (
              <tr key={a.account} className="border-t border-border/50">
                <td className="py-2 text-gray-200">{a.account}</td>
                <td className="py-2 mono">{a.ready}</td>
                <td className="py-2 mono">{a.processing}</td>
                <td className="py-2 mono">{a.pending}</td>
                <td className="py-2 mono">{a.authorized}</td>
                <td className="py-2 mono text-status-green">{a.published}</td>
                <td className="py-2 mono text-status-red">{a.error}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
