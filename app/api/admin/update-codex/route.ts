import { type NextRequest } from "next/server";

import { requireAncient } from "@/lib/auth/guard";
import { runCodexRebuild } from "@/lib/updateCodex";

// Dynamic so the gate reads the live session on every request (never cached).
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * Ancient-gated "Update Codex" action. `401` unauthenticated, `403` non-ancient.
 * For an ancient it pulls the latest `@ancientpantheon/codex` from npm and returns
 * the exit code + captured output + the before/after version delta. It never
 * restarts the running server (that would end this admin session) — see
 * {@link runCodexRebuild}.
 */
export async function POST(request: NextRequest) {
  const gate = await requireAncient(request);
  if (!gate.ok) return gate.response;

  const result = await runCodexRebuild();
  return Response.json(result, {
    status: result.ok ? 200 : 500,
    headers: NO_STORE,
  });
}
