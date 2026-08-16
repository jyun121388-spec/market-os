# Current Task

MILESTONE: M27 — Production QA

TASK: Every milestone through M26 was verified individually (its own Playwright script, its own
`npm run *:print`, its own integration tests) but the app has never had one continuous
cross-feature walkthrough exercising every real page and flow together in sequence, the way a
real user session would. Real scoping: full "production QA" (load testing, real traffic,
multi-environment) needs an actual deployment, which is gated behind the same
production-deployment Human Gate as M25's scheduler — not attempted here. What's genuinely
buildable now: (1) one comprehensive Playwright script/test exercising the full real user path
in this dev environment — signup, login, /today, /admin (both as unauthenticated redirect-check
and as a real logged-in view), logout, wrong-password rejection, the M26 lockout, and session
expiry — asserting on real rendered content at each step, not just HTTP status; (2) a pass over
`docs/RELEASE_CHECKLIST.md` comparing its criteria against actual current state, updating it
honestly (some criteria will still be open — that's expected, not a failure, given multiple
BLOCKED_HUMAN_GATE items).

STATUS: Not started — M26 (Security Hardening) complete and verified.

NEXT EXACT ACTION: Read `docs/RELEASE_CHECKLIST.md` in full first (if it exists) to know its
actual criteria, then write a single Playwright test file (not an ad hoc throwaway script this
time — a real `tests/e2e/*.spec.ts` or similar under version control, since this is exactly the
kind of full-flow regression coverage that should persist across sessions, not be re-typed each
time) covering the full walkthrough above. Run it for real against `npm run dev`. Update
RELEASE_CHECKLIST.md with an honest done/open status per item.
