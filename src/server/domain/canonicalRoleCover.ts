import {
  normalizeSubject,
  regionIsExactlyFramingAndIdentity,
  resolveStoredSubject,
} from "./subjectAuthority";

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
 *
 * ## Cover is not a second algorithm
 *
 * The whole-role test is `subjectAuthority.regionIsExactlyFramingAndIdentity`, which the mechanism
 * path already used on both relation endpoints. This module briefly carried its own copy, differing
 * only in which words count as framing, and ESC-015 §11 is explicit that the answer to a second
 * caller is to factor the authority rather than to write it again. The vocabulary is now the
 * parameter and the rule is shared, so a change to what "exactly covered" means reaches every role
 * at once -- and a mutation to it fails the mechanism tests and the observation tests together,
 * which is the property a single implementation is supposed to have.
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
      : discovered.filter((row) =>
          regionIsExactlyFramingAndIdentity(trimmed, nameOf(row), framingIsRecognised),
        );

  if (covering.length === 0) return { status: "UNRESOLVED", reason: "RESIDUE" };

  const names = [...new Set(covering.map((row) => normalizeSubject(nameOf(row)).trim()))];
  if (names.length > 1) {
    return { status: "AMBIGUOUS", names: [...new Set(covering.map(nameOf))].sort() };
  }
  return { status: "AUTHORIZED", rows: covering, name: nameOf(covering[0]) };
}
