"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/agents", label: "Agents" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/trace", label: "Trace" },
  { href: "/logs", label: "Logs" },
  { href: "/code", label: "Code" },
  { href: "/database", label: "Database" },
  { href: "/accounts", label: "Accounts" },
  { href: "/incidents", label: "Incidents" },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <nav className="flex h-full w-48 flex-col gap-0.5 border-r border-border bg-bg-panel p-3">
      {NAV.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded px-3 py-2 text-sm transition-colors ${
              active ? "bg-bg-raised text-white" : "text-gray-400 hover:bg-bg-raised/50 hover:text-gray-200"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
