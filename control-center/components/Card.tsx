import type { ReactNode } from "react";

export function Card({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-border bg-bg-panel p-4 ${className}`}>
      {title && <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">{title}</h3>}
      {children}
    </div>
  );
}

export function InferredTag() {
  return (
    <span className="ml-1.5 inline-flex items-center rounded border border-status-blue/30 bg-status-blue/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-status-blue">
      inferred from log
    </span>
  );
}

export function EvidenceTag({ source }: { source: string }) {
  return <span className="rounded border border-border bg-bg-raised px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gray-400">{source}</span>;
}
