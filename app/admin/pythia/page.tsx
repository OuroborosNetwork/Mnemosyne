import type { ReactElement } from "react";

import { PythiaPage } from "./PythiaPage.client";

// Ancient-gated Pythia connector page. Reads live config client-side, so nothing here
// is safe to statically cache.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Pythia Connector",
};

export default function Page(): ReactElement {
  return <PythiaPage />;
}
