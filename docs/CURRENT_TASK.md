# Current Task

MILESTONE: M09 — Claim Ledger + verification pipeline

TASK: Build on `src/server/domain/claimStore.ts` (M08, the write path) with a verification
layer: given a Claim, confirm its `evidence` actually references real, existing rows (e.g. an
`evidence.observationId` that really exists and really supports the claimed value), and that
INFERENCE claims carry a confidence score and (once M21 Ask Market exists) a list of
FACT/CALCULATION claim_ids they're grounded in. This is the "no hallucinated financial facts"
guarantee made mechanically checkable rather than just asserted in docs.

STATUS: Not started — M08 (Claim Ledger wired to a real caller) complete and verified.

NEXT EXACT ACTION: Design `verifyClaim(claimId)` in a new
`src/server/domain/claimVerification.ts`: for a FACT claim, look up `evidence.observationId`
(or `evidence.filingId`) and confirm it exists and that the claim text's stated value matches
the stored value (a cheap, deterministic string/number check — not an LLM judgment call). For
now this only needs to support the FACT-from-Observation shape `createFactClaimFromObservation`
produces; extend when CALCULATION/INFERENCE claims get real producers (M11, M21).
