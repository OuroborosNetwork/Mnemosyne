import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

import { type NextRequest } from "next/server";

import { requireAncient } from "@/lib/auth/guard";
import { readConstructorsStatus } from "@/lib/deploy/constructors";
import { startDevDeploy } from "@/lib/deploy/devDeploy";
import {
  deployLogPath,
  deployRequestPath,
  deployStatusPath,
  ensureSpoolDir,
} from "@/lib/deploy/spool";

// Dynamic + no-store: reads the live session on every request, never cached.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * GET → the unified constructors status (installed vs npm-latest for every
 * constructor + `anyUpdateAvailable` + `deployMode`). Drives the Deploy button.
 */
export async function GET(request: NextRequest) {
  const gate = await requireAncient(request);
  if (!gate.ok) return gate.response;
  const status = await readConstructorsStatus();
  return Response.json(status, { headers: NO_STORE });
}

/**
 * POST → start a deploy. Returns `{ id, mode }`; the client then opens the SSE
 * stream at `/api/admin/deploy/stream/<id>` to watch progress.
 *
 * - `dev`    (localhost): pulls the constructors at `@latest` in-process and streams
 *   npm's output into the deploy log. Reload picks up the new build.
 * - `bundle` (live): the running container can't rebuild itself, so this drops a
 *   request file in the spool for the privileged host deployer, which does the
 *   zero-downtime blue-green rebuild+swap and streams progress into the same log.
 *
 * `401` unauthenticated, `403` non-ancient.
 */
export async function POST(request: NextRequest) {
  const gate = await requireAncient(request);
  if (!gate.ok) return gate.response;

  const status = await readConstructorsStatus();
  const id = randomUUID();
  ensureSpoolDir();

  const constructorPins = status.constructors
    .filter((c) => c.wired)
    .map((c) => `${c.npmPackage}@latest`);

  const header =
    `Mnemosyne deploy ${id}\n` +
    `mode: ${status.deployMode}\n` +
    `constructors: ${constructorPins.join(", ")}\n` +
    `requested: ${new Date().toISOString()}\n` +
    "─".repeat(48) +
    "\n";
  writeFileSync(deployLogPath(id), header);
  writeFileSync(deployStatusPath(id), "queued");

  if (status.deployMode === "bundle") {
    // Signal the host deployer. It flips status → running and streams its build log.
    writeFileSync(
      deployRequestPath(id),
      JSON.stringify(
        {
          id,
          mode: "bundle",
          requestedAt: new Date().toISOString(),
          constructors: constructorPins,
        },
        null,
        2,
      ),
    );
  } else {
    startDevDeploy(id); // fire-and-forget; appends to the same log
  }

  return Response.json({ id, mode: status.deployMode }, { headers: NO_STORE });
}
