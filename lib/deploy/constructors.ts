import {
  fetchLatestCodexVersion,
  fetchLatestKhronotonVersion,
  isNewerVersion,
  readCodexUiVersion,
} from "../codexVersion";

/**
 * The status of one constructor (Codex, Khronoton, …) for the unified Deploy panel.
 * `installed` is what's compiled into / installed in the running build; `available`
 * is npm's latest (null if unreachable). `wired` is false for a constructor that
 * exists on npm but isn't a Mnemosyne dependency yet (Khronoton, today) — it can
 * never be "update available" because there's nothing installed to update.
 */
export interface ConstructorStatus {
  key: "codex" | "khronoton";
  label: string;
  npmPackage: string;
  installed: string;
  available: string | null;
  wired: boolean;
  updateAvailable: boolean;
}

/** Aggregate status across all constructors — the single source for the button state. */
export interface ConstructorsStatus {
  constructors: ConstructorStatus[];
  /** True when at least one WIRED constructor has a strictly-newer npm version. */
  anyUpdateAvailable: boolean;
  /** "bundle" = live standalone (deploy = on-box rebuild); "dev" = localhost pull. */
  deployMode: "bundle" | "dev";
}

/**
 * Read every constructor's installed-vs-available pair. Codex is wired (installed
 * version read from node_modules; update flagged when npm is newer). Khronoton is
 * NOT wired yet — we still surface its npm version as a preview, but it can't drive
 * a deploy, so `updateAvailable` stays false regardless.
 */
export async function readConstructorsStatus(): Promise<ConstructorsStatus> {
  const [codexInstalled, codexLatest, khronotonLatest] = await Promise.all([
    Promise.resolve(readCodexUiVersion()),
    fetchLatestCodexVersion(),
    fetchLatestKhronotonVersion(),
  ]);

  const codexUpdate =
    codexLatest !== null && codexInstalled !== "unknown"
      ? isNewerVersion(codexLatest, codexInstalled)
      : false;

  const constructors: ConstructorStatus[] = [
    {
      key: "codex",
      label: "Codex",
      npmPackage: "@ancientpantheon/codex",
      installed: codexInstalled,
      available: codexLatest,
      wired: true,
      updateAvailable: codexUpdate,
    },
    {
      key: "khronoton",
      label: "Khronoton",
      npmPackage: "@ancientpantheon/khronoton-core",
      installed: "not wired",
      available: khronotonLatest,
      wired: false,
      updateAvailable: false,
    },
  ];

  return {
    constructors,
    anyUpdateAvailable: constructors.some((c) => c.wired && c.updateAvailable),
    deployMode: process.env.NODE_ENV === "production" ? "bundle" : "dev",
  };
}
