import { describe, it, expect } from "vitest";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(__dirname, "..");
const nodeModules = join(repoRoot, "node_modules");

// Codex-critical runtime packages that must hoist to a SINGLE top-level copy at
// the Mnemosyne root, so the bundler can alias every importer onto that one copy.
// A second top-level copy (or a drifted @noble/curves pin) would fracture React
// hooks / the zustand store / the Apollo crypto curve across the Codex tree.
//
// Scope note (install layer vs bundler layer): nested copies DO exist deeper in
// the tree — the @ardrive/turbo-sdk web3 payment substack (x402 -> wagmi -> viem
// -> walletconnect/reown) nests its own @noble/curves/zustand. That is not fixable
// at the npm install layer; it is collapsed at the bundler seam (turbo-sdk -> its
// /web ESM build + resolve.alias for react/react-dom/zustand/@noble/curves) in the
// next.config bundler task. This test pins only what the install layer CAN
// guarantee: one hoisted top-level copy at the load-bearing versions.
const SINGLE_INSTANCE = [
  { pkg: "react", expectMajor: 19 },
  { pkg: "react-dom", expectMajor: 19 },
  { pkg: "zustand", expectMajor: 5 },
  // @noble/curves is pinned EXACT to 1.9.7 to match @stoachain/stoa-core's exact
  // peer pin — a single shared Apollo-curve instance depends on this exact match.
  { pkg: "@noble/curves", expectExact: "1.9.7" },
] as const;

function topLevelVersion(pkg: string): string | null {
  const dir = join(nodeModules, ...pkg.split("/"));
  const manifest = join(dir, "package.json");
  if (!existsSync(manifest)) return null;
  // A registry install is a real directory; a stray symlink here would mean the
  // package was not actually hoisted as the single shared top-level copy.
  if (lstatSync(dir).isSymbolicLink()) return null;
  return JSON.parse(readFileSync(manifest, "utf8")).version;
}

describe("Codex aggregate resolution (single npm package)", () => {
  // Mnemosyne now consumes the ONE bundled `@ancientpantheon/codex` aggregate from
  // the npm registry (it internally bundles codex-core/ui/ouronet/arweave). A clean
  // install must resolve it as a REAL registry directory — not a file: symlink out
  // to a sibling checkout (the pre-publish model) — so deploys need no Codex repo.
  it("@ancientpantheon/codex resolves to a real registry install, not a file: symlink", () => {
    const dir = join(nodeModules, "@ancientpantheon", "codex");
    expect(existsSync(dir), `${dir} must exist after install`).toBe(true);
    expect(
      lstatSync(dir).isSymbolicLink(),
      "@ancientpantheon/codex must be a registry install, not a file: symlink",
    ).toBe(false);
    const version = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
    expect(version, "aggregate version must be a semver string").toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("single top-level hoist (bundler-alias precondition)", () => {
  it.each(SINGLE_INSTANCE)("$pkg hoists to one top-level copy at the pinned version", (entry) => {
    const version = topLevelVersion(entry.pkg);
    expect(version, `${entry.pkg} must be hoisted to a single real top-level copy`).not.toBeNull();

    const [major] = version!.split(".");
    if ("expectExact" in entry) {
      expect(version, `${entry.pkg} must be the exact shared pin`).toBe(entry.expectExact);
    } else {
      expect(Number(major), `${entry.pkg} top-level copy must be v${entry.expectMajor}.x`).toBe(entry.expectMajor);
    }
  });
});
