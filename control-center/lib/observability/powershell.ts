// Hardened PowerShell execution helper. SECURITY INVARIANT: every call site in
// this codebase passes a 100% hardcoded script string (no string built from
// request input, query params, or any browser-supplied value). This module
// does not expose a way to run an arbitrary caller-supplied command — there
// is no public API that takes free-form text and forwards it to the shell.
// grep for `runPowerShell(` to audit every call site.
import { execFile } from "node:child_process";

const TIMEOUT_MS = 8000;

export function runPowerShell(script: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        // Never throw up to the caller — a failed/timed-out diagnostic command
        // must degrade to UNAVAILABLE, never crash an API route or a page.
        resolve({ stdout: stdout ?? "", stderr: stderr ? stderr + (error ? `\n${error.message}` : "") : error ? error.message : "" });
      }
    );
  });
}
