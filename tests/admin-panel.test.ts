import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Source-contract tests: the admin panel is a Hub-style set of ancient-gated client
// React trees (fetch + hooks) and the network wiring imports the browser-only
// @ancientpantheon/codex packages, neither of which can be exercised in a node vitest
// env without a real browser mount. Each assertion pins a concrete regression that
// would break a panel page or the operator-Pythia injection path if the wiring were
// removed. The interactive ancient view is owner-verify-in-browser (needs a real hub
// session).
//
// The admin surface is now a landing (a list of entry tiles) + one dedicated page per
// function, each wrapping its section in the shared <AdminGate>. The gate — not each
// section — owns the three auth states.

const root = process.cwd();
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");

describe("/admin route files", () => {
  it("has the server landing page + client landing so the gated UI is behind a client boundary", () => {
    expect(existsSync(join(root, "app", "admin", "page.tsx"))).toBe(true);
    expect(existsSync(join(root, "app", "admin", "AdminLanding.client.tsx"))).toBe(true);
  });

  it("has a shared client gate the pages reuse", () => {
    expect(existsSync(join(root, "app", "admin", "AdminGate.client.tsx"))).toBe(true);
    expect(read("app", "admin", "AdminGate.client.tsx")).toMatch(/^["']use client["'];?/m);
  });

  it("gives each function its own dedicated sub-page (Hub-style)", () => {
    for (const dir of ["pythia", "update-codex", "security", "network"]) {
      expect(existsSync(join(root, "app", "admin", dir, "page.tsx"))).toBe(true);
    }
  });

  it("lists every sub-page as an entry tile on the landing", () => {
    const landing = read("app", "admin", "AdminLanding.client.tsx");
    for (const href of [
      "/admin/codex",
      "/admin/update-codex",
      "/admin/pythia",
      "/admin/security",
      "/admin/network",
    ]) {
      expect(landing).toMatch(new RegExp(href.replace(/\//g, "\\/")));
    }
  });
});

describe("admin gate — the three auth states (REQ-08)", () => {
  const gate = () => read("app", "admin", "AdminGate.client.tsx");

  it("is a client component (it fetches /api/me and holds interactive state)", () => {
    expect(gate()).toMatch(/^["']use client["'];?/m);
  });

  it("drives its gate off /api/me so the panel reflects the live session, never a cached one", () => {
    expect(gate()).toMatch(/\/api\/me/);
  });

  it("offers a login link for an anonymous visitor instead of the panel", () => {
    expect(gate()).toMatch(/\/admin\/login/);
  });

  it("shows a not-authorized state for a signed-in non-ancient user (gates the mutations client-side too)", () => {
    expect(gate()).toMatch(/ancient/i);
    expect(gate()).toMatch(/not authorized/i);
  });
});

describe("admin — Pythia connector control (REQ-10)", () => {
  const panel = () => read("app", "admin", "pythia", "PythiaPage.client.tsx");

  it("is a client component behind the shared gate", () => {
    expect(panel()).toMatch(/^["']use client["'];?/m);
    expect(panel()).toMatch(/AdminGate/);
  });

  it("POSTs the operator gateway to the ancient-gated route", () => {
    expect(panel()).toMatch(/\/api\/admin\/pythia/);
  });

  it("reads the current operator value from the public config endpoint", () => {
    expect(panel()).toMatch(/\/api\/config/);
  });
});

describe("admin — Update Codex control (REQ-09, REVIEW M5/M6)", () => {
  const panel = () => read("app", "admin", "update-codex", "UpdateCodexPage.client.tsx");

  it("is a client component behind the shared gate", () => {
    expect(panel()).toMatch(/^["']use client["'];?/m);
    expect(panel()).toMatch(/AdminGate/);
  });

  it("POSTs to the ancient-gated update-codex route", () => {
    expect(panel()).toMatch(/\/api\/admin\/update-codex/);
  });

  it("surfaces the current codex-ui version passed from the server page", () => {
    expect(read("app", "admin", "update-codex", "page.tsx")).toMatch(/readCodexUiVersion/);
    expect(panel()).toMatch(/codexVersion/);
  });
});

describe("admin — Codex Security control (master-key rotation)", () => {
  const panel = () => read("app", "admin", "security", "SecurityPage.client.tsx");

  it("is a client component behind the shared gate", () => {
    expect(panel()).toMatch(/^["']use client["'];?/m);
    expect(panel()).toMatch(/AdminGate/);
  });

  it("reads master-key + codex status and rotates through the ancient-gated route", () => {
    expect(panel()).toMatch(/\/api\/admin\/security\/rotate-master-key/);
  });

  it("requires the export-backup acknowledgement before enabling rotation (irreversible)", () => {
    // The POST must carry acknowledgedExport:true and the button must gate on the ack.
    expect(panel()).toMatch(/acknowledgedExport/);
    expect(panel()).toMatch(/!acknowledged/);
    expect(panel()).toMatch(/irreversible/i);
  });
});

describe("admin — network surfacing (REQ-11)", () => {
  const panel = () => read("app", "admin", "network", "NetworkPage.client.tsx");

  it("shows StoaChain as live and Arweave as not-yet-verified", () => {
    expect(panel()).toMatch(/StoaChain/);
    expect(panel()).toMatch(/Arweave/);
    expect(panel()).toMatch(/not[- ]yet[- ]verified/i);
  });
});

describe("operator Pythia injection into the codex mount (REQ-10 wiring)", () => {
  it("resolveNetworkModel takes an operator Pythia URL that wins over the per-user field", () => {
    const ns = read("app", "codex", "networkSettings.ts");
    expect(ns).toMatch(/effectivePythiaUrl/);
    expect(ns).toMatch(/operatorPythiaUrl/);
  });

  it("the codex Dashboard fetches the operator /api/config value at mount and feeds it to the model", () => {
    const app = read("app", "codex", "CodexApp.tsx");
    expect(app).toMatch(/fetchOperatorPythiaUrl/);
    expect(app).toMatch(/operatorPythiaUrl/);
  });

  it("fetchOperatorPythiaUrl reads the public /api/config endpoint", () => {
    expect(read("lib", "pythiaUrl.ts")).toMatch(/\/api\/config/);
  });
});
