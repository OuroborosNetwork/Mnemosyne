import { exec } from "node:child_process";

import { readCodexUiVersion } from "./codexVersion";

/**
 * "Update Codex" server action — the real npm puller.
 *
 * Mnemosyne consumes the Codex as the single bundled npm package
 * {@link CODEX_PACKAGE}. This action pulls its latest published version
 * ({@link CODEX_REBUILD_COMMAND}) and reports the exit code + output + the
 * before/after version so the operator sees exactly what moved (e.g.
 * `0.5.0 → 0.6.0`). It deliberately does NOT restart the running server — a
 * restart from within the server would crash the very admin session that
 * triggered it; a pulled change is reflected after the operator's next reload
 * (dev) or the next standalone redeploy (prod, where CI rebuilds the bundle
 * against the updated pin).
 */

/** The single aggregate package Mnemosyne pulls the whole Codex from. */
export const CODEX_PACKAGE = "@ancientpantheon/codex";

/** The bounded, safe pull command: install the latest published aggregate. Never restarts. */
export const CODEX_REBUILD_COMMAND = `npm install ${CODEX_PACKAGE}@latest --no-audit --no-fund`;

/** How long the pull may run before it is abandoned (bounded, non-hanging). */
const REBUILD_TIMEOUT_MS = 5 * 60 * 1000;
/** Cap the captured output so a huge install log can't bloat the JSON response. */
const OUTPUT_LIMIT = 8_000;

export interface RebuildResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  /** The command that ran, echoed so the UI can show exactly what happened. */
  command: string;
  /** The operator-facing note surfaced next to the result in the UI. */
  note: string;
  /** Installed `@ancientpantheon/codex` version before the pull. */
  versionBefore: string;
  /** Installed `@ancientpantheon/codex` version after the pull. */
  versionAfter: string;
  /** True when the pull actually moved the installed version. */
  changed: boolean;
}

/** A runner is injectable so the action is testable without a real npm spawn. */
export type CommandRunner = (
  command: string,
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

const PHASE_NOTE =
  "Pulls the latest @ancientpantheon/codex from npm. It does NOT restart the " +
  "server (that would end this admin session) — reload to pick up the new build. " +
  "On the live site, a redeploy rebuilds the standalone bundle against the pin.";

/** The default runner: spawn the bounded command and capture stdout/stderr/exit. */
const defaultRunner: CommandRunner = (command) =>
  new Promise((resolve) => {
    exec(
      command,
      { timeout: REBUILD_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const exitCode =
          error && typeof (error as { code?: unknown }).code === "number"
            ? ((error as { code: number }).code)
            : error
              ? 1
              : 0;
        resolve({ exitCode, stdout: stdout ?? "", stderr: stderr ?? "" });
      },
    );
  });

const truncate = (s: string): string =>
  s.length > OUTPUT_LIMIT ? `${s.slice(0, OUTPUT_LIMIT)}\n…(truncated)` : s;

/**
 * Run the codex npm pull. Always resolves (never throws) so the route can always
 * answer: a thrown/failed runner is reported as `ok:false` with the error in
 * `stderr`, not propagated. `readVersion` is injectable for deterministic tests.
 */
export async function runCodexRebuild(
  runner: CommandRunner = defaultRunner,
  readVersion: () => string = readCodexUiVersion,
): Promise<RebuildResult> {
  const versionBefore = readVersion();
  try {
    const { exitCode, stdout, stderr } = await runner(CODEX_REBUILD_COMMAND);
    // Re-read from disk AFTER the install so the delta reflects the pull (the
    // reader uses readFileSync, not a cached require — a new version shows here).
    const versionAfter = exitCode === 0 ? readVersion() : versionBefore;
    return {
      ok: exitCode === 0,
      exitCode,
      stdout: truncate(stdout),
      stderr: truncate(stderr),
      command: CODEX_REBUILD_COMMAND,
      note: PHASE_NOTE,
      versionBefore,
      versionAfter,
      changed: versionBefore !== versionAfter,
    };
  } catch (err: unknown) {
    return {
      ok: false,
      exitCode: 1,
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
      command: CODEX_REBUILD_COMMAND,
      note: PHASE_NOTE,
      versionBefore,
      versionAfter: versionBefore,
      changed: false,
    };
  }
}
