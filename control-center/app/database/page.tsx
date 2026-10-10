"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/Card";

const TABLES = ["content_accounts", "content_files", "content_metadata", "social_accounts", "social_posts", "content_file_conflicts"] as const;

export default function DatabasePage() {
  const [table, setTable] = useState<(typeof TABLES)[number]>("content_files");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/database?table=${table}`)
      .then((r) => r.json())
      .then((d) => setRows(d.rows ?? []))
      .finally(() => setLoading(false));
  }, [table]);

  const columns = rows[0] ? Object.keys(rows[0]) : [];

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap gap-2">
          {TABLES.map((t) => (
            <button
              key={t}
              onClick={() => setTable(t)}
              className={`rounded px-3 py-1.5 text-sm ${table === t ? "bg-status-blue/20 text-status-blue" : "bg-bg-raised text-gray-400"}`}
            >
              {t}
            </button>
          ))}
        </div>
        {table === "social_accounts" && (
          <p className="mt-2 text-xs text-status-yellow">`credentials` is never returned by this API — only id/platform/channel_id/is_active.</p>
        )}
      </Card>

      <Card className="overflow-x-auto">
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-gray-500">
                {columns.map((c) => (
                  <th key={c} className="whitespace-nowrap py-2 pr-4">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="mono border-t border-border/40">
                  {columns.map((c) => (
                    <td key={c} className="max-w-xs truncate whitespace-nowrap py-1.5 pr-4 text-gray-300">
                      {String((row as Record<string, unknown>)[c] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-3 text-xs text-gray-500">{rows.length} row(s) shown (capped).</p>
      </Card>
    </div>
  );
}
