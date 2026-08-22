/**
 * Who this repository is, stated once, in committed source.
 *
 * The control bus has two state machines that both have to answer "is this message addressed to
 * us". They answered it differently — `consumer.ts` gained a project gate and `reconcile()` did
 * not — so `[CHATGPT_DECISION][OTHER-REPO][ESC-X]` came back `WRONG_PROJECT` from one and
 * `UNSOLICITED_DIRECTIVE` from the other. Found by independent verification of the first ESC-012
 * application (`[CHATGPT_VERIFIED][ESC-012]` REWORK_REQUIRED, comment 5379016462).
 *
 * Two disagreeing definitions of the same boundary is worse than one loose definition, because
 * whichever caller is consulted decides the answer. So the identity lives here and the comparison
 * lives in exactly one function, `matchProject` in `../escalation/transport`.
 *
 * **This is configuration, not inference.** It is a committed constant precisely so that it cannot
 * be derived from the thing being judged. Reading the project out of the incoming comment, its
 * author, its protocol id, or its prose would make every message self-authorising, which is the
 * shape of every authorisation bug this layer exists to prevent.
 */

/** The project segment this repository answers to, as it appears in a three-segment tag. */
export const LOCAL_PROJECT_ID = "MARKET-OS";

/** The GitHub repository the control bus is bound to. Recorded for audit; not used for matching. */
export const LOCAL_REPOSITORY = "jyun121388-spec/market-os";
