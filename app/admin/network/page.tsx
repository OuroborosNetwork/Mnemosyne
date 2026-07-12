import type { ReactElement } from "react";

import { NetworkPage } from "./NetworkPage.client";

export const metadata = {
  title: "Network Status",
};

export default function Page(): ReactElement {
  return <NetworkPage />;
}
