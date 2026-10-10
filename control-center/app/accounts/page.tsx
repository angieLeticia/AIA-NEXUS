"use client";

import { Card } from "@/components/Card";
import { usePoll } from "@/lib/hooks/usePoll";
import type { AccountSummary } from "@/types/observability";

export default function AccountsPage() {
  const { data } = usePoll<{ accounts: AccountSummary[] }>("/api/accounts", 10000);
  const accounts = data?.accounts ?? [];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {accounts.map((a) => (
        <Card key={a.account} title={a.account}>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <dt className="text-gray-500">Ready</dt>
              <dd className="mono text-gray-200">{a.ready}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Processing</dt>
              <dd className="mono text-gray-200">{a.processing}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Pending</dt>
              <dd className="mono text-gray-200">{a.pending}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Authorized</dt>
              <dd className="mono text-gray-200">{a.authorized}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Published</dt>
              <dd className="mono text-status-green">{a.published}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Error</dt>
              <dd className="mono text-status-red">{a.error}</dd>
            </div>
          </dl>
        </Card>
      ))}
      {accounts.length === 0 && <Card>Loading…</Card>}
    </div>
  );
}
