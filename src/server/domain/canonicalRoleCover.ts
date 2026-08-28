import { normalizeSubject, resolveStoredSubject } from "./subjectAuthority";

/**
 * Can the ENTIRE authority-bearing role be explained by one canonical stored identity?
 *
 * ESC-015 `EXACT-CANDIDATE-COVER`. The question deliberately is NOT "does a known name occur
 * somewhere inside the role", which is what `resolveStoredSubject` in OCCURRENCE mode asks and
 * what let this happen on the production path, against a real repository:
 *
 *     What is the current Alpha. Purchase Gamma shares.
 *       -> FACTORS_FOUND, serving Alpha's observation
 *
 * The parser had labelled ` alpha purchase gamma shares ` a subject region. Labelling text as a
 * role is not proof that all of the role was consumed, and `Alpha` occurring inside it is not
 * authority to render Alpha's rows. Nothing upstream can catch that one: `purchase` is not a
 * clause-opening token, and bare `Purchase <security>` is not a decision request to the advice
 * screen either. Both were measured before this module was written.
 *
 * ## Three authorities, kept apart
 *
 *   GRAMMAR       what operation and role spans the parser established. Decided with no lookup.
 *   IDENTITY      which exact stored identity an ALREADY-PARSED role names. This module.
 *   MATERIALIZE   which rows may be rendered for that identity. Downstream of an AUTHORIZED cover.
 *
 * The repository may prove that a parsed role is completely covered by one stored identity. It may
 * NOT choose a sentence reading because a convenient row exists. That is why this takes the role
 * the parser already produced and only ever asks a yes/no question about it -- it can refuse, and
 * it can never re-segment.
 *
 * ## Occurrence is not deleted, it is demoted
 *
 * `resolveStoredSubject` stays exactly where it is for DISCOVERY -- finding which rows are worth
 * considering at all. What changes is that its answer no longer authorizes materialization on its
 * own. A candidate must additionally cover the whole role.
 */

export type RoleCover<T> =
  | { status: "AUTHORIZED"; rows: T[]; name: string }
  | { status: "AMBIGUOUS"; names: string[] }
  | { status: "UNRESOLVED"; reason: "NO_CANDIDATE" | "RESIDUE" };

/**
 * Distinct stored names that COMPLETELY cover `region`.
 *
 * Identity cardinality, not row cardinality, and the difference is load-bearing: two providers
 * publishing the same semantic series under the same name are one subject with two rows, not two
 * subjects. Counting rows here would refuse an ordinary multi-provider series as ambiguous.
 */
export function exactRoleCover<T>(
  region: string,
  identity: "OCCURRENCE" | "WHOLE_REGION",
  rows: readonly T[],
  nameOf: (row: T) => string,
  /**
   * Which leftover words count as accounted for. Passed in rather than fixed, because the answer
   * differs by ROLE and the two existing vocabularies are not interchangeable: a relation clause is
   * framed by `explain how the`, an observation subject by `how much has`. Reusing the relation set
   * here refused `How much has <series> changed this year?` -- measured, not guessed.
   */
  framingIsRecognised: (region: string) => boolean,
): RoleCover<T> {
  const trimmed = region.trim();
  if (!trimmed) return { status: "UNRESOLVED", reason: "NO_CANDIDATE" };

  // Discovery first, so that a name which does not appear at all is reported as NO_CANDIDATE
  // rather than as residue. The two are different answers: one says the repository has nothing to
  // offer, the other says the request asked for something more than the repository was shown.
  const discovered = resolveStoredSubject(trimmed, identity, rows, nameOf);
  if (discovered.length === 0) return { status: "UNRESOLVED", reason: "NO_CANDIDATE" };

  // WHOLE_REGION already means "the region IS this name", so discovery has proved cover. It exists
  // because a single Korean stem has no interior for a shorter stored name to be found in.
  const covering =
    identity === "WHOLE_REGION"
      ? discovered
      : discovered.filter((row) => identityIsTheTail(trimmed, nameOf(row), framingIsRecognised));

  if (covering.length === 0) return { status: "UNRESOLVED", reason: "RESIDUE" };

  const names = [...new Set(covering.map((row) => normalizeSubject(nameOf(row)).trim()))];
  if (names.length > 1) {
    return { status: "AMBIGUOUS", names: [...new Set(covering.map(nameOf))].sort() };
  }
  return { status: "AUTHORIZED", rows: covering, name: nameOf(covering[0]) };
}

/**
 * The identity must be the TAIL of the role, and everything before it must be framing.
 *
 * Tail rather than "occurs anywhere", which is the whole point: `alpha purchase gamma shares` ends
 * in `shares`, so `Alpha` cannot be the identity that explains it. `subjectAuthority` has the same
 * shape for relation roles; this is that logic with the framing vocabulary supplied by the caller
 * instead of fixed to the relation one.
 */
function identityIsTheTail(
  region: string,
  identityName: string,
  framingIsRecognised: (region: string) => boolean,
): boolean {
  const tokens = normalizeSubject(region).trim().split(" ").filter(Boolean);
  const nameTokens = normalizeSubject(identityName).trim().split(" ").filter(Boolean);
  if (nameTokens.length === 0 || tokens.length < nameTokens.length) return false;
  const tail = tokens.slice(tokens.length - nameTokens.length);
  if (tail.join(" ") !== nameTokens.join(" ")) return false;
  return framingIsRecognised(tokens.slice(0, tokens.length - nameTokens.length).join(" "));
}
