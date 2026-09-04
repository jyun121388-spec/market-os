import { prisma } from "@/server/db/client";
import type { CausalEdge } from "@/generated/prisma/client";

/**
 * Read access to the Economic Causal Graph (docs/PRODUCT_SPEC.md). Exact-match lookups only —
 * no fuzzy/semantic matching, since a mismatched fuzzy match here would misattribute a causal
 * claim to the wrong variable. Multi-hop path-finding is intentionally out of scope for this
 * milestone (see docs/CURRENT_TASK.md); it belongs to whichever future milestone actually
 * presents causal chains to a user (M21 Ask Market).
 */

export async function getEdgesFrom(variable: string): Promise<CausalEdge[]> {
  return prisma.causalEdge.findMany({ where: { fromVariable: variable } });
}

export async function getEdgesTo(variable: string): Promise<CausalEdge[]> {
  return prisma.causalEdge.findMany({ where: { toVariable: variable } });
}

/**
 * A single-hop transmission check: does a direct, stored edge exist from `from` to `to`? This
 * deliberately returns the full edge (with its required counterexamples/confidence) rather
 * than a bare boolean, so a caller can never present "yes, causal" without also surfacing the
 * edge's stated limitations.
 */
export async function getDirectEdge(from: string, to: string): Promise<CausalEdge | null> {
  return prisma.causalEdge.findFirst({ where: { fromVariable: from, toVariable: to } });
}
