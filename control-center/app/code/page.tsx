"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Card } from "@/components/Card";
import type { FileTreeNode } from "@/lib/observability/codeExplorer";

// Monaco pulls in browser-only globals — must be client-side only.
const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

function languageFor(path: string): string {
  if (path.endsWith(".ts") || path.endsWith(".mts") || path.endsWith(".tsx")) return "typescript";
  if (path.endsWith(".js") || path.endsWith(".mjs")) return "javascript";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".md")) return "markdown";
  if (path.endsWith(".ps1")) return "powershell";
  if (path.endsWith(".sql")) return "sql";
  return "plaintext";
}

function TreeNode({ node, onSelect, depth = 0 }: { node: FileTreeNode; onSelect: (path: string) => void; depth?: number }) {
  const [open, setOpen] = useState(depth < 1);
  if (node.type === "file") {
    return (
      <button
        onClick={() => onSelect(node.relativePath)}
        className="block w-full truncate rounded px-2 py-0.5 text-left text-xs text-gray-400 hover:bg-bg-raised hover:text-gray-200"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {node.name}
      </button>
    );
  }
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="block w-full truncate rounded px-2 py-0.5 text-left text-xs font-medium text-gray-300 hover:bg-bg-raised"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {open ? "▾" : "▸"} {node.name}
      </button>
      {open && node.children?.map((c) => <TreeNode key={c.relativePath} node={c} onSelect={onSelect} depth={depth + 1} />)}
    </div>
  );
}

export default function CodePage() {
  const [tree, setTree] = useState<FileTreeNode[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [tabs, setTabs] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/code/tree")
      .then((r) => r.json())
      .then((d) => setTree(d.tree));
  }, []);

  const openFile = async (path: string) => {
    setSelected(path);
    setTabs((t) => (t.includes(path) ? t : [...t, path]));
    const res = await fetch(`/api/code/file?path=${encodeURIComponent(path)}`);
    const data = await res.json();
    setContent(data.content ?? `// ${data.error ?? "Unable to load file"}`);
  };

  return (
    <div className="flex h-full gap-4">
      <Card className="w-64 shrink-0 overflow-y-auto" title="Repository">
        {tree.map((n) => (
          <TreeNode key={n.relativePath} node={n} onSelect={openFile} />
        ))}
      </Card>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => openFile(t)}
              className={`mono shrink-0 rounded-t border border-b-0 border-border px-3 py-1.5 text-xs ${
                selected === t ? "bg-bg-raised text-gray-100" : "bg-bg-panel text-gray-500"
              }`}
            >
              {t.split("/").pop()}
            </button>
          ))}
        </div>
        {selected && <div className="mono px-1 text-[11px] text-gray-500">{selected}</div>}
        <div className="flex-1 overflow-hidden rounded-lg border border-border">
          {selected ? (
            <MonacoEditor
              height="100%"
              theme="vs-dark"
              language={languageFor(selected)}
              value={content}
              options={{ readOnly: true, domReadOnly: true, minimap: { enabled: false }, fontSize: 13 }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-gray-500">Select a file from the tree.</div>
          )}
        </div>
      </div>
    </div>
  );
}
