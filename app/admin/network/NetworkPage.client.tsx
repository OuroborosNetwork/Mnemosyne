"use client";

import type { ReactElement } from "react";

import { AdminGate } from "../AdminGate.client";

/**
 * Network surfacing: the per-chain connection status. StoaChain is live; the Arweave
 * path is not yet verified for Mnemosyne (its connection factory is not publicly
 * exported and the flow is unproven), so it is shown as such.
 */
function NetworkStatusSection(): ReactElement {
  return (
    <section className="mnemo-admin-card">
      <h2 className="mnemo-admin-h2">Network status</h2>
      <ul className="mnemo-admin-chainlist">
        <li>
          <span className="mnemo-admin-chain">StoaChain</span>
          <span className="mnemo-admin-badge mnemo-admin-badge--live">live</span>
        </li>
        <li>
          <span className="mnemo-admin-chain">Arweave</span>
          <span className="mnemo-admin-badge">not-yet-verified</span>
        </li>
      </ul>
    </section>
  );
}

export function NetworkPage(): ReactElement {
  return (
    <AdminGate title="Network Status">
      <NetworkStatusSection />
    </AdminGate>
  );
}

export default NetworkPage;
