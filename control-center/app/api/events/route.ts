// SSE stream of Live Activity events, derived purely from incremental log
// tailing. One-directional: Browser <- SSE <- READ ONLY EVENTS. This handler
// never reads a request body and accepts no parameters that influence what
// runs server-side — there is no way for a client to send a command through
// this connection, only to receive events.
import { logSourcesForToday, readNewLines } from "@/lib/observability/logTailer";
import type { EvidenceSource, LiveEvent, Severity } from "@/types/observability";

export const dynamic = "force-dynamic";

const POLL_MS = 2500;

function severityFor(level: string): Severity {
  if (level === "ERROR" || level === "CRITICAL") return "CRITICAL";
  if (level === "WARNING") return "WARNING";
  return "GREEN";
}

function sourceFor(sourceFile: string): EvidenceSource {
  if (sourceFile.includes("task-wrapper")) return "TASK";
  return "LOG";
}

export async function GET(request: Request) {
  const encoder = new TextEncoder();
  let interval: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: LiveEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      // Prime offsets without emitting a backlog burst on connect — the first
      // readNewLines() call per source seeds the tail window silently.
      for (const source of logSourcesForToday()) readNewLines(source.absolutePath);

      interval = setInterval(() => {
        try {
          for (const source of logSourcesForToday()) {
            const lines = readNewLines(source.absolutePath);
            for (const line of lines) {
              // Prefer the real tag parsed from the line itself (e.g. [SCHEDULE],
              // [WHISPER]) over the source file's own label — agent/logs/agent-*.log
              // is shared by Watcher/Analyze/Schedule/Publish, so the file label
              // alone would mislabel a Scheduler line as "Watcher".
              const parsedTagIsGeneric = line.component === source.absolutePath.split(/[\\/]/).pop();
              send({
                timestamp: line.timestamp,
                source: sourceFor(source.absolutePath),
                component: parsedTagIsGeneric ? source.label : line.component,
                severity: severityFor(line.level),
                message: line.message,
              });
            }
          }
        } catch {
          // A transient read failure must never kill the stream.
        }
      }, POLL_MS);

      // Keep-alive comment every 20s so proxies/browsers don't time out an
      // idle connection.
      const keepAlive = setInterval(() => controller.enqueue(encoder.encode(`: keep-alive\n\n`)), 20_000);

      request.signal.addEventListener("abort", () => {
        if (interval) clearInterval(interval);
        clearInterval(keepAlive);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      if (interval) clearInterval(interval);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
