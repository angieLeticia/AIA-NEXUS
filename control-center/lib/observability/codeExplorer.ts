// Read-only code explorer backend. SECURITY INVARIANTS:
//   1. Only files under WHITELISTED_DIRS, with an ALLOWED_EXTENSION, are ever
//      readable — never an arbitrary path.
//   2. Every requested path is resolved with path.resolve() and the result is
//      verified to still start with CORE_ROOT + one of the whitelisted dirs
//      BEFORE reading — this is what defeats "../" traversal: resolve()
//      collapses "..", and the prefix check then rejects anything that
//      escaped the sandbox, rather than trying to pattern-match "..".
//   3. This module never executes anything — no child_process, no eval, no
//      dynamic import of the files it reads. It only returns their text.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { CORE_ROOT } from "./roles";

export const WHITELISTED_DIRS = ["agent", "scripts/pipeline", "lib/social", "control-center"];
export const ALLOWED_EXTENSIONS = new Set([".ts", ".mts", ".tsx", ".js", ".mjs", ".json", ".md", ".ps1", ".sql"]);
const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB — refuse to load anything larger into Monaco

export interface FileTreeNode {
  name: string;
  relativePath: string;
  type: "file" | "directory";
  children?: FileTreeNode[];
}

function isPathAllowed(absolute: string): boolean {
  const normalized = path.resolve(absolute);
  if (!normalized.startsWith(CORE_ROOT)) return false;
  const relative = path.relative(CORE_ROOT, normalized);
  if (relative.startsWith("..")) return false;
  return WHITELISTED_DIRS.some((dir) => {
    const dirAbs = path.resolve(CORE_ROOT, dir);
    return normalized === dirAbs || normalized.startsWith(dirAbs + path.sep);
  });
}

function shouldSkipDir(name: string): boolean {
  return name === "node_modules" || name === ".next" || name === ".git" || name.startsWith(".");
}

export function listTree(relativeDir = ""): FileTreeNode[] {
  const roots = relativeDir ? [relativeDir] : WHITELISTED_DIRS;
  const nodes: FileTreeNode[] = [];
  for (const root of roots) {
    const absRoot = path.resolve(CORE_ROOT, root);
    if (!isPathAllowed(absRoot) || !existsSync(absRoot)) continue;
    nodes.push(buildNode(absRoot, root, root));
  }
  return nodes;
}

function buildNode(absolute: string, relative: string, displayName?: string): FileTreeNode {
  const stat = statSync(absolute);
  const name = displayName ?? path.basename(absolute) ?? relative;
  if (stat.isDirectory()) {
    const children: FileTreeNode[] = [];
    let entries: string[] = [];
    try {
      entries = readdirSync(absolute);
    } catch {
      entries = [];
    }
    for (const entry of entries.sort()) {
      if (shouldSkipDir(entry)) continue;
      const childAbs = path.join(absolute, entry);
      const childRel = path.join(relative, entry);
      let childStat;
      try {
        childStat = statSync(childAbs);
      } catch {
        continue;
      }
      if (childStat.isDirectory()) {
        children.push(buildNode(childAbs, childRel));
      } else if (ALLOWED_EXTENSIONS.has(path.extname(entry))) {
        children.push({ name: entry, relativePath: childRel.split(path.sep).join("/"), type: "file" });
      }
    }
    return { name, relativePath: relative.split(path.sep).join("/"), type: "directory", children };
  }
  return { name, relativePath: relative.split(path.sep).join("/"), type: "file" };
}

export interface FileReadResult {
  relativePath: string;
  content: string;
  truncated: boolean;
  sizeBytes: number;
}

export function readWhitelistedFile(relativePath: string): FileReadResult | { error: string } {
  // Reject absolute paths, drive letters, and any ".." segment outright
  // before even touching the filesystem — defense in depth on top of the
  // resolve()+prefix check below.
  if (path.isAbsolute(relativePath) || /^[a-zA-Z]:/.test(relativePath) || relativePath.split(/[\\/]/).includes("..")) {
    return { error: "Rejected: path must be relative, within the whitelist, and contain no '..' segments." };
  }

  const absolute = path.resolve(CORE_ROOT, relativePath);
  if (!isPathAllowed(absolute)) {
    return { error: "Rejected: path is outside the whitelisted directories." };
  }
  if (!ALLOWED_EXTENSIONS.has(path.extname(absolute))) {
    return { error: "Rejected: file extension not in the allowed list." };
  }
  if (!existsSync(absolute)) {
    return { error: "File not found." };
  }
  const stat = statSync(absolute);
  if (!stat.isFile()) {
    return { error: "Not a file." };
  }
  if (stat.size > MAX_FILE_BYTES) {
    const buf = readFileSync(absolute);
    return { relativePath, content: buf.subarray(0, MAX_FILE_BYTES).toString("utf-8"), truncated: true, sizeBytes: stat.size };
  }
  const content = readFileSync(absolute, "utf-8");
  return { relativePath, content, truncated: false, sizeBytes: stat.size };
}
