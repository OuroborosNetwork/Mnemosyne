import type { ReactElement } from "react";

import { SecurityPage } from "./SecurityPage.client";

// Ancient-gated Codex Security page. Reads live master-key / codex status client-side,
// so nothing here is safe to statically cache.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Codex Security",
};

export default function Page(): ReactElement {
  return <SecurityPage />;
}
