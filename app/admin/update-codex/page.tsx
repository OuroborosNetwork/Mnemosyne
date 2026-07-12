import type { ReactElement } from "react";

import { readCodexUiVersion } from "@/lib/codexVersion";

import { UpdateCodexPage } from "./UpdateCodexPage.client";

// Ancient-gated Update Codex page. Reads the installed codex-ui version server-side
// (a server-only fs read) and hands it to the client control, which does the live
// /api/me gate + the interactive version check / pull.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Update Codex",
};

export default function Page(): ReactElement {
  return <UpdateCodexPage codexVersion={readCodexUiVersion()} />;
}
