import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * The deploy spool — the container ↔ host-deployer handoff directory.
 *
 * The running Mnemosyne container CANNOT rebuild itself (it would terminate the very
 * process doing the rebuild) and MUST NOT hold Docker/nginx power (least privilege).
 * So a live "Deploy" drops a request file here; a privileged host-side deployer
 * (see `deploy/host/`) watches this directory, does the blue-green rebuild+swap, and
 * streams progress back into `<id>.log`/`<id>.status` — which the container tails
 * over SSE. Because the spool lives on the HOST volume (mounted into the container),
 * the log survives the container swap and the NEW container can resume the tail.
 *
 * Location: `MNEMOSYNE_DEPLOY_DIR` if set, else `<dataDir>/deploy`, where `<dataDir>`
 * is the parent of `MNEMOSYNE_CODEX_DIR` (so it sits beside the sealed codex on the
 * same persistent volume), falling back to `<cwd>/data/deploy` in dev.
 */
export function deploySpoolDir(): string {
  const explicit = process.env.MNEMOSYNE_DEPLOY_DIR;
  if (explicit && explicit.length > 0) return explicit;
  const codexDir = process.env.MNEMOSYNE_CODEX_DIR;
  const dataDir = codexDir ? dirname(codexDir) : join(process.cwd(), "data");
  return join(dataDir, "deploy");
}

/** Create the spool dir (idempotent) and return it. */
export function ensureSpoolDir(): string {
  const dir = deploySpoolDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** A deploy id is a uuid; validate before using it in a path (traversal guard). */
export function isValidDeployId(id: string): boolean {
  return /^[a-f0-9-]{8,64}$/i.test(id);
}

export const deployLogPath = (id: string): string =>
  join(deploySpoolDir(), `${id}.log`);
export const deployStatusPath = (id: string): string =>
  join(deploySpoolDir(), `${id}.status`);
export const deployRequestPath = (id: string): string =>
  join(deploySpoolDir(), `${id}.request.json`);

/** The lifecycle of a single deploy, written one-word into `<id>.status`. */
export type DeployStatus = "queued" | "running" | "success" | "failed";

/** True once the deploy has reached a terminal state (the SSE tail may close). */
export function isTerminalStatus(s: string): s is "success" | "failed" {
  return s === "success" || s === "failed";
}
