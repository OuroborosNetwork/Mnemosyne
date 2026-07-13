import { readFileSync, statSync } from "node:fs";

import { type NextRequest } from "next/server";

import { requireAncient } from "@/lib/auth/guard";
import {
  deployLogPath,
  deployStatusPath,
  isTerminalStatus,
  isValidDeployId,
} from "@/lib/deploy/spool";

export const dynamic = "force-dynamic";

/** Poll cadence for tailing the log + status files off the shared volume. */
const POLL_MS = 500;
/** Safety cap so a wedged deploy can't hold the SSE connection forever. */
const MAX_MS = 20 * 60 * 1000;

function readStatus(id: string): string {
  try {
    return readFileSync(deployStatusPath(id), "utf8").trim();
  } catch {
    return "queued";
  }
}

/**
 * SSE progress stream for a deploy. Tails `<id>.log` from the last byte offset and
 * emits each new chunk as a `data:` event; emits an `event: status` on every status
 * change and an `event: done` when terminal, then closes. Both files live on the
 * HOST volume, so if the deploy swaps THIS container, the browser's EventSource
 * auto-reconnects to the fresh container which re-opens the same log from offset 0 —
 * the client resets its buffer on reconnect, so the terminal stays consistent.
 *
 * `401` unauthenticated, `403` non-ancient, `400` on a malformed id.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireAncient(request);
  if (!gate.ok) return gate.response;

  const { id } = await params;
  if (!isValidDeployId(id)) {
    return Response.json({ error: "bad deploy id" }, { status: 400 });
  }

  const logFile = deployLogPath(id);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let offset = 0;
      let lastStatus = "";
      const startedAt = Date.now();
      let closed = false;

      const send = (event: string | null, data: string) => {
        const lines = data.split("\n").map((l) => `data: ${l}`).join("\n");
        const frame = (event ? `event: ${event}\n` : "") + `${lines}\n\n`;
        controller.enqueue(encoder.encode(frame));
      };

      const finish = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const tick = () => {
        if (closed) return;
        // New log bytes since our last offset.
        try {
          const size = statSync(logFile).size;
          if (size > offset) {
            const fd = readFileSync(logFile);
            const chunk = fd.subarray(offset, size).toString("utf8");
            offset = size;
            // Trim the single trailing newline so we don't emit an empty data line.
            send(null, chunk.replace(/\n$/, ""));
          }
        } catch {
          /* log not created yet — keep polling */
        }

        const status = readStatus(id);
        if (status !== lastStatus) {
          lastStatus = status;
          send("status", status);
        }

        if (isTerminalStatus(status)) {
          send("done", status);
          finish();
          return;
        }
        if (Date.now() - startedAt > MAX_MS) {
          send("done", "timeout");
          finish();
        }
      };

      const timer = setInterval(tick, POLL_MS);
      tick(); // emit the header immediately

      request.signal.addEventListener("abort", finish);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
    },
  });
}
