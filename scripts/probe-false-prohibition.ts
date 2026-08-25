/**
 * Which answerable development cases are being called PROHIBITED, and by which rule.
 *
 * A false prohibition is the most expensive error this parser can make: it tells a user the product
 * must not answer an ordinary question. IR-107 measured 44 of them at once, and the repair was to
 * stop treating imperative MOOD as evidence of purpose. Any new prohibition rule has to be checked
 * against the same failure, which is what this is for — it isolates the answerable cases that
 * refuse as PROHIBITED and shows the possessive determiner, if any, that governs.
 */

import { REQUEST_DEVELOPMENT_CORPUS } from "../tests/fixtures/requestDevelopmentCorpus";
import { resolveRequestAuthority } from "@/server/domain/requestAuthority";
import { eojeols, KOREAN_POSSESSIVE_DETERMINERS } from "@/server/domain/koreanMorphology";

for (const c of REQUEST_DEVELOPMENT_CORPUS) {
  if (c.expected !== "ANSWERABLE") continue;
  const authority = resolveRequestAuthority(c.query);
  if (authority.status !== "PROHIBITED") continue;
  const tokens = eojeols(c.query);
  const determiners = tokens.filter(
    (t, i) => i < tokens.length - 1 && KOREAN_POSSESSIVE_DETERMINERS.includes(t),
  );
  console.log(
    `${c.id} ${c.language} ${c.operation.padEnd(32)} ${c.query}\n` +
      `        determiner=${determiners.join(",") || "none (English rule or advice detector)"}`,
  );
}
