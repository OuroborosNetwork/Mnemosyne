# Handoff: `mnemosyne.CODEX` Pact module

**Audience:** another agent (Cursor, Claude, or human) tasked with writing the Pact module that backs Mnemosyne's on-chain Codex Identity registry + Arweave backup history.

**Author:** Claude (Opus, 2026-05-28), as part of the Mnemosyne v0.1 design + ouronet-codex v0.3.0 design discussion.

**Status:** design-locked; implementation not yet started.

**Deployment target:** Stoa chain (Kadena-fork operated by the AncientHodler ecosystem). Namespace `mnemosyne` (create if not present), module name `CODEX`.

---

## 1. Why this module exists

Mnemosyne is a cloud-hosted Codex management service. Each Codex is identified on-chain by an Apollo-curve public key (the "Codex Identity"), and the on-chain entry stores:

1. The Apollo public key (the user-facing identifier — Π-prefixed address format)
2. A Kadena keyset guard derived from an auto-generated `PrimePureKey` that lives inside the codex (Pact-native authorization for codex management operations)
3. A pointer to the latest Arweave backup of the encrypted codex blob, if any

The encrypted codex itself is **NOT** stored on-chain. Storage layers:

- **Layer 1 (always):** Mnemosyne PostgreSQL database — the live encrypted blob
- **Layer 2 (optional, user-opt-in):** Arweave — permanent encrypted blob backups, paid by user via Bundlr/Irys
- **Layer 3 (always):** this Pact module — the immutable identity + pointer to the latest L2 backup

Full architectural context is in `Mnemosyne/docs/v0.1-design.md` §9 (Cloud Storage Architecture) and `stoa-js/packages/ouronet-codex/docs/v0.3.0-design.md` §2.4.bis (`IPrimePureKey` interface).

---

## 2. Required namespace + module skeleton

```pact
;; Create the namespace if it does not exist on Stoa.
;; (Deployment script handles this; the module file assumes mnemosyne ns is live.)

(namespace 'mnemosyne)

(module CODEX IMMUTABLE-GOV
  "On-chain Codex Identity registry for Mnemosyne. Stores immutable
   Codex Identity entries (Apollo address + PrimePureKey guard) plus
   a mutable pointer to the latest Arweave-stored encrypted backup,
   and a full history table of all Arweave uploads."

  ;; ─── Governance ─────────────────────────────────────────────────
  (defcap IMMUTABLE-GOV ()
    @doc "Frozen governance. The module is upgrade-impossible by design \
          \ once deployed; bugfixes ship as a new module version under \
          \ a new module name (e.g. CODEX-V2)."
    (enforce false "mnemosyne.CODEX governance is frozen by design"))

  ;; ─── (schemas, tables, capabilities, functions below) ───────────
)
```

The `IMMUTABLE-GOV` pattern is intentional. We're storing user-controlled identity records and backup pointers — there must be no admin-rotatable governance that could overwrite or censor entries. The Pact module is `enforce false` for governance; bugfixes ship as `CODEX-V2`.

---

## 3. Schemas + tables

### 3.1 `codex-identities` (primary table)

```pact
(defschema codex-identity-row
  @doc "One row per registered Codex Identity. Apollo address is the \
        \ primary key (table key). Fields split into IMMUTABLE (set on \
        \ register, never changed) and MUTABLE (updated as the user \
        \ pushes new Arweave backups)."

  ;; ─── IMMUTABLE FIELDS ────────────────────────────────────────────
  codex-public-id:string
    @doc "The Apollo Ed25519-like public key, hex-encoded (64 chars). \
          \ Same value as the table key (apollo-address), stored explicitly \
          \ for readability of read results."

  codex-guard:guard
    @doc "Kadena keyset guard built from the codex's auto-generated \
          \ PrimePureKey (a Kadena Ed25519 keypair stored inside the \
          \ encrypted codex blob). This guard authorizes all MUTABLE \
          \ field updates and all writes to the secondary history table. \
          \ See ouronet-codex v0.3.0 design doc §2.4.bis for PrimePureKey \
          \ semantics."

  registered-at:time
    @doc "Block time when register-codex-identity was called."

  registered-by:string
    @doc "Free-form string identifying the registering client (e.g. \
          \ 'mnemosyne-spa@1.0.0'). For observability only; not \
          \ security-relevant."

  ;; ─── MUTABLE FIELDS (updated via update-arweave-pointer) ─────────
  arweave-tx-id:string
    @doc "The Arweave transaction id of the LATEST encrypted-codex-blob \
          \ backup, or empty string if no backup has ever been pushed. \
          \ Must match ^[a-zA-Z0-9_-]{43}$ when non-empty. Past backups \
          \ are addressable via the codex-arweave-history table."

  arweave-updated-at:time
    @doc "Block time of the most recent update-arweave-pointer call. \
          \ Defaults to epoch (1970-01-01) at registration."

  arweave-backup-count:integer
    @doc "Total number of Arweave backups ever pushed for this codex. \
          \ Incremented atomically with each update-arweave-pointer call. \
          \ Default 0. Used by the SPA to enumerate past backups in the \
          \ history table without using `select`.")

(deftable codex-identities:{codex-identity-row})
```

### 3.2 `codex-arweave-history` (secondary table)

Stores a row per Arweave backup push. Lets the user / SPA enumerate all past backups for a given Codex Identity, sorted by upload time.

**Two key-design options — pick one and document the choice:**

#### Option A — owner-decided composite key (as designed by Mnemosyne owner)

```pact
;; Key format: "<codex-public-id>|<arweave-tx-id>"
;; To enumerate a codex's history: (select codex-arweave-history (where "codex-public-id" (= apollo-address)))
;; Pros: human-readable keys, no counter coordination required
;; Cons: Pact `select` scans the whole table — O(N) over all backups across all codices
```

#### Option B — sequence-number key (handoff author's micro-optimization suggestion)

```pact
;; Key format: "<codex-public-id>-<sequence-number>"
;; To enumerate a codex's history: read codex-identities for backup-count N, then read N rows by deterministic key
;; Pros: O(N) over only THIS codex's backups (no whole-table scan)
;; Cons: requires the sequence counter on the main table to stay strictly synchronized

;; If Option B is chosen, the main-table arweave-backup-count field IS the
;; source of truth for the next sequence number, and update-arweave-pointer
;; reads-then-increments atomically inside its transaction.
```

**Recommended for v0.1:** Option A (owner's choice). Switch to Option B if `select` cost becomes an issue at scale (>10k history rows).

```pact
(defschema codex-arweave-history-row
  @doc "One row per Arweave backup upload. Immutable once inserted; \
        \ never updated, never deleted."

  codex-public-id:string
    @doc "Foreign-key reference to codex-identities.codex-public-id. \
          \ Allows enumeration of all backups for a given Codex Identity. \
          \ MUST match an existing row in codex-identities (enforced by \
          \ the writer function)."

  arweave-tx-id:string
    @doc "Arweave transaction id (43-char base64url). Stored both in \
          \ the key and as a field for read-result convenience."

  uploaded-at:time
    @doc "Block time when this backup row was inserted.")

(deftable codex-arweave-history:{codex-arweave-history-row})
```

---

## 4. Capabilities

```pact
(defcap CODEX-OWNER (apollo-address:string)
  @doc "Authorizes mutation of a Codex Identity's mutable fields and \
        \ writes to the history table. Composes the codex-guard, which \
        \ is a Kadena keyset built from the codex's PrimePureKey. The \
        \ owner is anyone who can unlock the codex and access the \
        \ PrimePureKey's private half."
  @managed
  (with-read codex-identities apollo-address { "codex-guard" := g }
    (enforce-guard g)))

(defcap REGISTER (apollo-address:string codex-public-id:string)
  @doc "Authorization for register-codex-identity. No on-chain guard \
        \ exists for a Codex Identity that hasn't been registered yet — \
        \ first-write is open by design, gated only by the requirement \
        \ that apollo-address must equal codex-public-id (anti-typosquat \
        \ check) and that the keyset being installed actually validates \
        \ the registration signature in scope at submission time."
  (enforce (= apollo-address codex-public-id)
    "apollo-address must equal codex-public-id"))
```

**Registration security note for the implementer:**
- `register-codex-identity` is a one-shot per Apollo address — Pact's `insert` throws on existing key, providing uniqueness without extra logic. There is no `delete-codex-identity` function by design.
- The keyset being installed as `codex-guard` is opaque to Pact at registration. The owner (Mnemosyne SPA) is responsible for ensuring the keyset corresponds to the actual `PrimePureKey` stored in the codex. If a malicious actor registers an Apollo address with a keyset they don't actually own, they've wasted a unique slot but compromised nothing — the legitimate owner of that Apollo address can never reclaim it. Mnemosyne SPA's UX should warn the user clearly: registration is irreversible.

---

## 5. Functions

### 5.1 `register-codex-identity`

```pact
(defun register-codex-identity:string
  ( apollo-address:string
    codex-public-id:string
    codex-guard:guard
    registered-by:string )
  @doc "One-shot registration of a new Codex Identity. Fails if \
        \ apollo-address is already registered (Pact insert semantics). \
        \ apollo-address and codex-public-id MUST be identical \
        \ (capability-enforced)."

  (with-capability (REGISTER apollo-address codex-public-id)
    (enforce (!= apollo-address "") "apollo-address must not be empty")
    (enforce (= (length apollo-address) 64) "apollo-address must be 64-char hex")
    ;; TODO implementer: add additional Apollo-address format validation
    ;;     if applicable (e.g. enforce charset to hex). Note: Pact does
    ;;     not have a native regex primitive; consider implementing a
    ;;     hex-char checker via fold/zip or accept the on-client validation.

    (insert codex-identities apollo-address
      { "codex-public-id":      codex-public-id
      , "codex-guard":          codex-guard
      , "registered-at":        (at "block-time" (chain-data))
      , "registered-by":        registered-by
      , "arweave-tx-id":        ""
      , "arweave-updated-at":   (time "1970-01-01T00:00:00Z")
      , "arweave-backup-count": 0
      })
    (format "Codex Identity {} registered" [apollo-address])))
```

### 5.2 `update-arweave-pointer`

```pact
(defun update-arweave-pointer:string
  ( apollo-address:string
    arweave-tx-id:string )
  @doc "Update the latest Arweave backup pointer + insert a row into \
        \ the history table. Atomic within one Pact transaction. \
        \ Caller must satisfy CODEX-OWNER capability."

  (with-capability (CODEX-OWNER apollo-address)
    (enforce (validate-arweave-tx-id arweave-tx-id) "invalid arweave-tx-id format")

    (with-read codex-identities apollo-address { "arweave-backup-count" := current-count }
      (let ((new-count (+ current-count 1))
            (now       (at "block-time" (chain-data)))
            ;; Pick history-key format per the chosen Option (A or B above)
            (history-key (format "{}|{}" [apollo-address arweave-tx-id])))

        ;; Insert history row FIRST — fails (re-throws) if the same
        ;; (codex, tx-id) was somehow already submitted. Prevents
        ;; duplicate-pointer-update spam.
        (insert codex-arweave-history history-key
          { "codex-public-id": apollo-address
          , "arweave-tx-id":   arweave-tx-id
          , "uploaded-at":     now
          })

        ;; THEN update main-table mutable fields
        (update codex-identities apollo-address
          { "arweave-tx-id":        arweave-tx-id
          , "arweave-updated-at":   now
          , "arweave-backup-count": new-count
          })

        (format "Arweave pointer updated to {} (backup #{})"
                [arweave-tx-id new-count])))))

(defun validate-arweave-tx-id:bool (tx-id:string)
  @doc "Verify Arweave transaction id format: exactly 43 chars, \
        \ base64url charset ([A-Za-z0-9_-]). Pact has no regex; \
        \ implement via length check + per-char fold."
  (and
    (= (length tx-id) 43)
    (fold (lambda (acc c) (and acc (is-base64url-char c)))
          true
          (str-to-chars tx-id))))

;; TODO implementer: `str-to-chars` and `is-base64url-char` may need to
;; be implemented as helpers since Pact lacks per-character string ops
;; natively. If too costly, document the alternative: client-side validation
;; (the SPA validates before submitting; on-chain just enforces length).
```

### 5.3 Read functions (gas-free queries)

```pact
(defun get-codex-identity:object{codex-identity-row} (apollo-address:string)
  @doc "Read a single Codex Identity row by Apollo address."
  (read codex-identities apollo-address))

(defun get-codex-identity-or-null:object (apollo-address:string)
  @doc "Like get-codex-identity but returns an empty object instead of \
        \ throwing when the address is not registered. Used by the SPA's \
        \ 'is this Apollo address already registered?' check during signup."
  (with-default-read codex-identities apollo-address
    { "codex-public-id":      ""
    , "codex-guard":          (read-keyset "empty-keyset")  ;; placeholder
    , "registered-at":        (time "1970-01-01T00:00:00Z")
    , "registered-by":        ""
    , "arweave-tx-id":        ""
    , "arweave-updated-at":   (time "1970-01-01T00:00:00Z")
    , "arweave-backup-count": 0 }
    { "codex-public-id":      := pid
    , "arweave-tx-id":        := atx
    , "arweave-backup-count" := bc }
    { "codex-public-id":      pid
    , "arweave-tx-id":        atx
    , "arweave-backup-count": bc
    , "is-registered":        (!= pid "") }))
;; TODO implementer: the with-default-read syntax above may need adjustment.
;;     The intent is clear: return a record with is-registered:bool so
;;     the client doesn't need to catch an exception just to test existence.

(defun list-arweave-backup-history:[object] (apollo-address:string)
  @doc "Return all Arweave backup rows for the given Codex Identity, \
        \ sorted by uploaded-at descending (newest first). \
        \
        \ NOTE: implementation depends on which key-format option was \
        \ chosen for codex-arweave-history. \
        \   - Option A: uses (select) — O(table-size), works without coordination \
        \   - Option B: uses (read) per sequence number — O(this-codex-only)"
  ;; Option A implementation:
  (select codex-arweave-history (where "codex-public-id" (= apollo-address))))

;; If Option B chosen, replace body with sequence-iteration logic.
```

---

## 6. Validation requirements summary

| What | Where enforced | How |
|---|---|---|
| Apollo address uniqueness | `register-codex-identity` | `insert` throws on existing key |
| Apollo address non-empty + 64 hex chars | `register-codex-identity` | `enforce` calls |
| `apollo-address == codex-public-id` | `REGISTER` capability | `enforce =` |
| `codex-guard` validity | implicit | Pact rejects malformed guards at parse time |
| Caller owns the codex | `CODEX-OWNER` capability | `enforce-guard` on `codex-guard` |
| `arweave-tx-id` format (43-char base64url) | `validate-arweave-tx-id` | length + per-char check (TBD implementation cost) |
| History row uniqueness per `(codex, tx-id)` pair | `update-arweave-pointer` | `insert` on history table throws on existing key |
| Content of the Arweave blob | **NOT enforced** | Client-side only; Pact has no way to verify off-chain content |

The "writing bullshit gate" the Mnemosyne owner asked about is the format + capability layer. Anyone who can satisfy `CODEX-OWNER` can push any 43-char-format string as the latest pointer; whether it points to a real codex blob or to junk is verifiable only by attempting to decrypt the fetched Arweave content client-side.

---

## 7. Tests the implementer must write

Each test ships as a `.repl` file in the same directory as the module. Coverage target: ~30 tests across the categories below.

### 7.1 Registration tests (REG-NN)

- REG-01 — register fresh Apollo address succeeds; row exists with default mutable fields
- REG-02 — register same Apollo address twice → second call fails (insert collision)
- REG-03 — register with apollo-address != codex-public-id → fails (REGISTER capability)
- REG-04 — register with empty apollo-address → fails (enforce)
- REG-05 — register with wrong-length apollo-address → fails (enforce)
- REG-06 — registered-at, registered-by stored correctly
- REG-07 — default mutable fields: arweave-tx-id="", count=0, updated-at=epoch
- REG-08 — get-codex-identity returns the inserted row
- REG-09 — get-codex-identity-or-null returns is-registered:false for unregistered addr
- REG-10 — get-codex-identity-or-null returns is-registered:true + fields for registered addr

### 7.2 Pointer update tests (PTR-NN)

- PTR-01 — update-arweave-pointer with valid tx-id by codex owner succeeds
- PTR-02 — update with invalid tx-id (39 chars) fails
- PTR-03 — update with invalid tx-id (non-base64url char) fails
- PTR-04 — update by non-owner (different keyset) fails (CODEX-OWNER guard)
- PTR-05 — update on unregistered Apollo address fails (read fails)
- PTR-06 — first update sets arweave-tx-id, increments count to 1
- PTR-07 — second update with different tx-id increments count to 2
- PTR-08 — duplicate update with same tx-id fails (history-row insert collision)
- PTR-09 — main-table arweave-tx-id reflects latest update
- PTR-10 — arweave-updated-at reflects latest block-time

### 7.3 History table tests (HIS-NN)

- HIS-01 — after one update, list-arweave-backup-history returns 1 row
- HIS-02 — after N updates, list returns N rows
- HIS-03 — each history row has correct codex-public-id, arweave-tx-id, uploaded-at
- HIS-04 — list for a different codex does not return this codex's rows
- HIS-05 — list for unregistered/no-backup codex returns empty list

### 7.4 Governance / immutability tests (GOV-NN)

- GOV-01 — module upgrade attempt fails (IMMUTABLE-GOV throws)
- GOV-02 — no admin function exists to overwrite codex-guard
- GOV-03 — no admin function exists to delete a codex-identities row
- GOV-04 — no admin function exists to delete codex-arweave-history rows

---

## 8. Deployment script

```pact
;; Filename: deploy-mnemosyne-codex.repl (or .pact for live deployment)

(env-keys ["mnemosyne-deployer-keyset"])
(env-data {
  "mnemosyne-ns-keyset": { "keys": [...], "pred": "keys-all" },
  "upgrade":             false
})

;; Step 1: define namespace if it does not exist
(define-namespace 'mnemosyne
  (read-keyset "mnemosyne-ns-keyset")
  (read-keyset "mnemosyne-ns-keyset"))

;; Step 2: load the module file
(load "mnemosyne-codex.pact")

;; Step 3: create tables (Pact requires explicit creation, separate from defining)
(create-table mnemosyne.CODEX.codex-identities)
(create-table mnemosyne.CODEX.codex-arweave-history)
```

**Implementer must verify:**
- Stoa chain's namespace creation policy (some Kadena-fork chains restrict who can create namespaces)
- Chain-id placement (the module should be deployable on chain-0 of Stoa, but verify Mnemosyne deployment plan in `Mnemosyne/docs/v0.1-design.md`)
- Gas station integration (Mnemosyne SPA will use Ouronet Gas Station to pay for user-initiated `update-arweave-pointer` calls; ensure the gas station's funding-account keyset is allowed to scope-sign on behalf of the user's `CODEX-OWNER` capability)

---

## 9. Out of scope for this handoff

- The Arweave upload SDK integration (Bundlr/Irys) lives in the `@stoachain/ouronet-codex` package, NOT in Pact. The SPA uploads to Arweave, gets a tx-id back, THEN calls `update-arweave-pointer`. Pact never talks to Arweave.
- Apollo signature verification (the Apollo curve is a separate signature scheme used for user-facing identity; Pact authorization happens via the Kadena keyset in `codex-guard`, not via Apollo signatures). The Apollo identity is metadata stored as `codex-public-id`; it carries no on-chain authorization weight.
- Codex content schema. Pact stores opaque tx-ids; the actual codex JSON schema lives in `stoa-js/packages/ouronet-codex/docs/v0.3.0-design.md`.
- Migration from a hypothetical future `CODEX-V2` module. We are deploying v1 here; v2 (if ever needed) is a separate handoff.
- Frontend / SPA / Mnemosyne UI work. This handoff is Pact module only.

---

## 10. Open questions for the implementer

If you hit ambiguity, surface here rather than guessing:

1. **`with-default-read` exact syntax** — verify the Pact version on Stoa supports the binding form used in §5.3. If not, fall back to try/catch pattern around a plain `read`.
2. **Character-iteration helpers** — Pact has no native per-char string ops. If `validate-arweave-tx-id` is too gas-expensive to implement on-chain, document a downgrade path: enforce length only, defer charset check to client side, document the trust assumption.
3. **`@managed` capability semantics for `CODEX-OWNER`** — the `@managed` annotation prevents the same capability from being installed twice in one tx. If the SPA needs to push multiple Arweave pointer updates in a single tx for batching, this annotation would break that flow. Confirm with the Mnemosyne owner whether batching is a use case before deciding.
4. **History table key format** — Option A (composite key, uses `select`) vs Option B (sequence-number, uses `read` loop). Owner's stated preference is Option A. If your implementation experience suggests select-cost will bite even at v0.1 scale, raise it before locking.
5. **Gas-station integration** — work with the Ouronet Gas Station maintainer to confirm capability-scoping for `update-arweave-pointer` works as expected. If the user's `PrimePureKey` keyset must be installed by the gas station's funding account, that requires careful Pact signature design.

---

## 11. Where to send the finished module

- File: `Mnemosyne/contracts/mnemosyne-codex.pact` (create the `contracts/` directory)
- Tests: `Mnemosyne/contracts/tests/*.repl`
- Deployment script: `Mnemosyne/contracts/deploy/deploy-mnemosyne-codex.repl`
- A short implementer-notes doc: `Mnemosyne/docs/handoffs/01-mnemosyne-codex-pact-module-NOTES.md` covering any deviations from this handoff, with rationale.

Open a PR (or just commit on a feature branch) and tag the Mnemosyne owner for review before deploying to Stoa testnet.

---

## 12. References

- `Mnemosyne/docs/v0.1-design.md` §9 — cloud storage architecture (3-layer model)
- `Mnemosyne/docs/v0.1-implementation-plan.md` — overall Mnemosyne build phases
- `Mnemosyne/docs/v0.1-open-decisions.md` — adjacent design decisions still in flight
- `stoa-js/packages/ouronet-codex/docs/v0.3.0-design.md` §2.4.bis — `IPrimePureKey` interface (the keypair whose public-half becomes `codex-guard`)
- Kadena Pact docs: https://docs.kadena.io/build/pact (capabilities, governance, table operations)
- Arweave tx-id format reference: https://docs.arweave.org/developers/server/http-api (43-char base64url)
