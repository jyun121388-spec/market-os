# Current Task

MILESTONE: M13 — Economic Causal Graph

TASK: Per docs/PRODUCT_SPEC.md "Economic Causal Graph": transmission-path edges between
economic variables/events, each with direction, confidence, evidence, lag, conditions, and
counterexamples. Correlation must never be presented as confirmed causation — this is a hard
guardrail, not a nice-to-have (docs/ARCHITECTURE.md). Unlike M03-M12, this is NOT primarily a
data-ingestion milestone — there's no external API for "causal edges." It's a schema +
curation milestone: design a `CausalEdge` model, then seed a small number of well-established,
textbook-level macro transmission mechanisms (e.g. oil price -> transportation cost ->
inflation pressure -> rate expectations -> bond yields) as an initial, honestly-labeled-as-
illustrative dataset — not claim these are empirically validated for the current economy.

STATUS: Not started — M12 (Economic Calendar, partial scope) complete and verified.

NEXT EXACT ACTION: Design `CausalEdge` in prisma/schema.prisma: fromVariable, toVariable
(free-text or references into Series where applicable), direction
(POSITIVE/NEGATIVE/AMBIGUOUS), confidence (never a false-precision number — consider a
LOW/MEDIUM/HIGH enum instead of a fabricated float), evidence (text description + optional
citation), lag (text description, e.g. "1-2 quarters" — not a fabricated precise number),
conditions (text), counterexamples (text, required — no edge without at least one acknowledged
counterexample or limitation, forcing epistemic honesty into the schema itself). Seed 5-10
well-known mechanisms. No "find a path between A and B" traversal logic needed yet at this
milestone — that's presentation-layer work for a future Ask Market integration (M21).
