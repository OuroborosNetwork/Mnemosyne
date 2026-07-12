"use client";

import { useEffect, useState, type ReactElement, type ReactNode } from "react";

import { AuthStatus } from "@/components/AuthStatus";

import "./admin.css";

/** The `/api/me` shape (mirrors the route handler payload). */
interface MeResponse {
  authenticated: boolean;
  name?: string;
  roles?: string[];
}

function isAncient(me: MeResponse | null): boolean {
  return Boolean(me?.authenticated && me.roles?.includes("ancient"));
}

/**
 * The shared ancient-only gate for every admin page (the landing and each
 * sub-page). Gates client-side off `/api/me` (the routes gate again server-side —
 * this is UX, not the security boundary):
 *  - session still loading → "Checking your session…";
 *  - not authenticated → a "Login with AncientHub" prompt;
 *  - authenticated, not ancient → a "Not authorized" notice;
 *  - ancient → the page body ({@link children}) inside `.mnemo-admin-sections`.
 *
 * Renders the standard header (a back link + the page title on the left, the
 * {@link AuthStatus} widget on the right). `backHref`/`backLabel` default to the
 * admin landing so sub-pages return there; the landing overrides them to point at
 * the Mnemosyne home.
 */
export function AdminGate({
  title,
  children,
  backHref = "/admin",
  backLabel = "← Back to Admin",
}: {
  title: string;
  children: ReactNode;
  backHref?: string;
  backLabel?: string;
}): ReactElement {
  const [me, setMe] = useState<MeResponse | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/me", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: MeResponse) => {
        if (active) setMe(data);
      })
      .catch(() => {
        if (active) setMe({ authenticated: false });
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="mnemo-admin">
      <header className="mnemo-admin-header">
        <div className="mnemo-admin-headleft">
          <a className="mnemo-admin-btn mnemo-admin-btn--ghost" href={backHref}>
            {backLabel}
          </a>
          <h1 className="mnemo-admin-title">{title}</h1>
        </div>
        <AuthStatus />
      </header>

      {me === null ? (
        <p className="mnemo-admin-muted">Checking your session…</p>
      ) : !me.authenticated ? (
        <section className="mnemo-admin-gate">
          <p className="mnemo-admin-muted">
            Sign in with your AncientHub account to manage Mnemosyne.
          </p>
          <a className="mnemo-admin-btn mnemo-admin-btn--primary" href="/admin/login">
            Login with AncientHub
          </a>
        </section>
      ) : !isAncient(me) ? (
        <section className="mnemo-admin-gate">
          <p className="mnemo-admin-notice" role="alert">
            Not authorized — the admin panel requires the <strong>ancient</strong>{" "}
            role. You are signed in as {me.name ?? "an operator"}
            {me.roles?.length ? ` (${me.roles.join(", ")})` : ""}.
          </p>
        </section>
      ) : (
        <div className="mnemo-admin-sections">{children}</div>
      )}
    </main>
  );
}

export default AdminGate;
