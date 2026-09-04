/**
 * Who may see the operator dashboard.
 *
 * `/admin` renders internal pipeline health: source tiers, ingest targets, completeness
 * shortfalls, unresolved data conflicts, and persisted ingest error messages. Until 2026-08-18 it
 * checked only that *a* user was signed in, and the schema has no role — `Plan` is `FREE`/`PRO`,
 * which is a billing tier and not an authorization boundary. On a product with open signup that
 * means anyone who registers reads the operator view. Found by independent review
 * (`gpt-5.6-terra`).
 *
 * An allowlist rather than a schema role, deliberately. Adding `isOperator` to `User` is the
 * better long-term model, but it needs a migration during a release freeze and creates a
 * bootstrapping problem — every existing row defaults to false, so nobody can reach `/admin`
 * until someone edits the database by hand. An environment allowlist closes the hole now, is
 * reversible, and does not touch the schema. Recorded in `docs/DECISIONS.md` so the migration is
 * a deliberate later choice rather than something this quietly rules out.
 *
 * **Fail closed.** An unset or empty `ADMIN_EMAILS` grants nobody access. The alternative —
 * treating "unconfigured" as "allow everyone" — is precisely the defect being fixed, and it would
 * reappear the first time someone deployed without setting the variable.
 */

/** Emails permitted to view `/admin`, from the comma-separated `ADMIN_EMAILS` environment value. */
function operatorEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/**
 * True only for an email explicitly listed in `ADMIN_EMAILS`.
 *
 * Comparison is case-insensitive and whitespace-trimmed on both sides, because addresses arrive
 * from a form on one side and a hand-edited environment variable on the other, and a stray space
 * silently locking out the only operator is a bad failure mode.
 */
export function isOperatorEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (normalized.length === 0) return false;
  return operatorEmails().includes(normalized);
}
