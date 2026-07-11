import { describe, it, expect } from "vitest";

import { runCodexRebuild, CODEX_REBUILD_COMMAND, CODEX_PACKAGE } from "../lib/updateCodex";

describe("runCodexRebuild — the npm codex puller", () => {
  it("runs the bounded npm pull and reports its exit code + stdout back to the operator", async () => {
    const calls: string[] = [];
    const result = await runCodexRebuild(
      async (command) => {
        calls.push(command);
        return { exitCode: 0, stdout: "added 1 package, changed 1 package", stderr: "" };
      },
      () => "0.5.0",
    );
    // The injected runner proves the command is the bounded npm pull, not a
    // server-killing restart.
    expect(calls).toEqual([CODEX_REBUILD_COMMAND]);
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("added");
  });

  it("pulls the latest of the single aggregate package (not the old sub-packages)", () => {
    expect(CODEX_PACKAGE).toBe("@ancientpantheon/codex");
    expect(CODEX_REBUILD_COMMAND).toContain("@ancientpantheon/codex@latest");
  });

  it("reports the before/after version delta so the operator sees what moved", async () => {
    // readVersion is injected: 0.5.0 before the pull, 0.6.0 after (a real pull).
    const versions = ["0.5.0", "0.6.0"];
    let call = 0;
    const result = await runCodexRebuild(
      async () => ({ exitCode: 0, stdout: "changed 1 package", stderr: "" }),
      () => versions[Math.min(call++, versions.length - 1)],
    );
    expect(result.versionBefore).toBe("0.5.0");
    expect(result.versionAfter).toBe("0.6.0");
    expect(result.changed).toBe(true);
  });

  it("marks changed:false when the pull leaves the version untouched (already latest)", async () => {
    const result = await runCodexRebuild(
      async () => ({ exitCode: 0, stdout: "up to date", stderr: "" }),
      () => "0.5.0",
    );
    expect(result.versionBefore).toBe("0.5.0");
    expect(result.versionAfter).toBe("0.5.0");
    expect(result.changed).toBe(false);
  });

  it("reports ok:false with the exit code when the pull fails, and keeps the old version", async () => {
    const result = await runCodexRebuild(
      async () => ({ exitCode: 1, stdout: "", stderr: "npm ERR! 404 Not Found" }),
      () => "0.5.0",
    );
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("npm ERR!");
    // A failed pull must not claim a version change.
    expect(result.versionAfter).toBe("0.5.0");
    expect(result.changed).toBe(false);
  });

  it("never restarts the running server — the command is an npm install only", () => {
    expect(CODEX_REBUILD_COMMAND).not.toMatch(/next (dev|start|build)|restart|pm2|kill/);
    expect(CODEX_REBUILD_COMMAND).toMatch(/npm install/);
  });

  it("catches a thrown runner and returns ok:false rather than propagating (the route must always answer)", async () => {
    const result = await runCodexRebuild(
      async () => {
        throw new Error("spawn ENOENT");
      },
      () => "0.5.0",
    );
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("spawn ENOENT");
    expect(result.changed).toBe(false);
  });
});
