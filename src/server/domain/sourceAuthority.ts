/**
 * Which exact stored `Source` a request named — one authority, shared by every door.
 *
 * IR-107 B2-C. This function lived inside `askMarket`, where it served the deterministic path and
 * nothing else. That was the whole problem, and it is not a tidiness complaint: measured against
 * real PostgreSQL, with only provider Y publishing a subject, a request naming provider X came back
 * AUTHORIZED carrying Y's series on BOTH the canonical and legacy candidate envelopes, and the
 * planner was called with it. The deterministic path refused the same request correctly, because it
 * was the only path that could see this code.
 *
 * A wrong-source answer is the worst shape of error this product has. The figure is real, the
 * subject is right, and the attribution is false — which is exactly what makes it credible.
 *
 * ## Grammar and identity stay apart
 *
 * `RequestAuthority.sourceRegion` carries the source constituent as TEXT: the grammar proved
 * something occupied the source role, and proved nothing about whether this repository holds such a
 * source. Identity is established here, against stored rows. A caller or a model asserting a
 * `sourceId` is never a substitute, the parser must not resolve identity, and this module must not
 * parse.
 *
 * ## Two matches is not a tie
 *
 * `Source.name` is free text and is not unique, so two rows may legitimately answer to the same
 * name, and a request in which two different providers both occur did not say which one it meant.
 * AMBIGUOUS is the answer — not the longer one, and not the first row.
 *
 * ## What was NOT promoted
 *
 * An untracked draft of this module existed in the tree, named by two planning documents. It was
 * the PRE-COVER version of the same function: no full-role cover, no `RESIDUE` status. Staging it
 * because a document mentioned it would have reintroduced the defect ESC-015 §8 closed. The tracked
 * logic was moved here instead and the draft overwritten.
 */

import { prisma } from "@/server/db/client";
import { explicitlyNamed, regionIsExactlyFramingAndIdentity } from "./subjectAuthority";
import { requestFramingIsRecognised } from "./requestAuthority";
import { isGenericThirdPartyReference } from "./requestFrame";

/**
 * A named source resolved to a repository identity, or a refusal.
 *
 * The parsed source constituent is TEXT. It becomes authority only by matching a `Source` this
 * repository actually holds, and matching more than one is not a tie to be broken — two providers
 * whose names both occur in the request means the request did not say which.
 */
export type SourceResolution =
  | { status: "RESOLVED"; sourceId: string; code: string }
  | { status: "AMBIGUOUS"; codes: string[] }
  | { status: "RESIDUE" }
  | { status: "UNRESOLVED" };

export async function resolveSourceIdentity(sourceRegion: string): Promise<SourceResolution> {
  const region = sourceRegion.trim();
  if (!region) return { status: "UNRESOLVED" };
  const sources = await prisma.source.findMany({
    select: { id: true, code: true, name: true },
    // A unique tiebreak, per `orderingDeterminism`: source codes are unique today, and an
    // ordering that relies on that staying true is an ordering that can tie tomorrow.
    orderBy: [{ code: "asc" }, { id: "asc" }],
  });
  // Containment of the WHOLE name, not overlap. `mentionsEachOther` is a retrieval heuristic and
  // it reported both "Test PB Source A" and "Test PB Source B" as matching a request that named
  // one of them -- three shared words out of four. Retrieval may guess; identity may not.
  //
  // Unicode-aware, matching `subjectAuthority.normalizeSubject`. An ASCII-only character class
  // erases a non-Latin source name to the empty string, and the empty string is contained in
  // every request -- so the check would have resolved every source, or none, on a name it could
  // not see.
  const normalize = (text: string) =>
    ` ${text
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()} `;
  const haystack = normalize(region);
  // A code is not a name and does not nest the way names do, so it is matched separately.
  const byCode = sources.filter((src) => haystack.includes(normalize(src.code)));
  // Keep only maximal names -- by OCCURRENCE, for the same reason as subjects. Naming the longer
  // source makes both whole names occur and the shorter was read out of the longer, so it must go;
  // but naming BOTH ("Rework Data, Rework Data Research") names two providers, and a name-level
  // containment test could not tell those two situations apart. It answered the second one by
  // silently picking the longer provider, which is a false attribution with a confident tone.
  // Same deletion as the series path: the whole-name containment pre-filter decided nothing that
  // `explicitlyNamed` does not decide again, since a name with no occurrence has no occurrence.
  const byName = explicitlyNamed(sources, (src) => src.name, region);
  const hits = [...new Map([...byName, ...byCode].map((src) => [src.id, src])).values()];

  // FULL-ROLE COVER on the source role. ESC-015 §8.
  //
  // Occurrence found which providers are worth considering. It does not settle whether the role
  // said anything else, and until this ran, it did not have to: measured against a real repository,
  // `What did <provider> Purchase Gamma shares publish about <series>?` returned FACTORS_FOUND and
  // published the reading under that provider's attribution. The parser hands this function
  // `<provider> purchase gamma shares` as the source region and considers the request authorized --
  // `scripts/probe-source-role-residue.ts` prints five such regions.
  //
  // Attribution is a stronger claim than a figure. A reading published as "what <provider>
  // reported" says a named organisation said something, so the role that names it has to be
  // explainable by that name and framing, with nothing left over.
  //
  // Either the name or the code may be the identity that explains the role, because both are ways
  // a request can name a provider and `byCode` above matches on the second. The rule itself is the
  // one the subject and relation roles use; only the vocabulary is chosen here.
  const covering = hits.filter(
    (src) =>
      regionIsExactlyFramingAndIdentity(region, src.name, requestFramingIsRecognised) ||
      regionIsExactlyFramingAndIdentity(region, src.code, requestFramingIsRecognised),
  );
  if (covering.length === 1) {
    return { status: "RESOLVED", sourceId: covering[0].id, code: covering[0].code };
  }
  if (covering.length > 1) return { status: "AMBIGUOUS", codes: covering.map((h) => h.code) };
  // A provider was named and the role said more. That is not the same as naming no provider this
  // repository holds, and the caller reports them differently -- one is a role this grammar could
  // not account for, the other is a genuine gap in inventory.
  if (hits.length > 0) return { status: "RESIDUE" };
  return { status: "UNRESOLVED" };
}

/**
 * Did the source role name a PARTY at all, or only say that somebody else reported it?
 *
 * The B2-C repair binds an attributed request to exactly one stored provider, and applied without
 * this distinction it removes the operation rather than securing it: every frame-eligible attributed
 * request in this repository's corpus reads `What did analysts publish about X?`, and `analysts` is
 * the vocabulary that PROVES the third-party frame, not a party. Requiring it to resolve to a stored
 * `Source` refused 54 tests' worth of ordinary behaviour.
 *
 * Wrong-source substitution is publishing Y's record for a request that named X. A request naming
 * nobody cannot suffer it. What it must not do is name a provider this repository does not hold and
 * be answered from one it does — which is the other half, and stays refused.
 */
export function sourceRoleNamesAParty(sourceRegion: string): boolean {
  return sourceRegion.trim() !== "" && !isGenericThirdPartyReference(sourceRegion);
}
