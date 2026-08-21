# reviews/

Stores the machine-readable output of independent (non-Claude) code reviews run against this
repository. Currently this holds Codex final-review results; the naming convention leaves room
for other independent reviewers later (`market-os-final-review-<reviewer>.json`) without
reserving the plain name for Codex specifically forever — but until a second reviewer is in use,
`market-os-final-review.json` refers to the Codex run.

See `docs/CODEX_REVIEW_PACKET.md` §12-15 for:

- the exact procedure to produce `market-os-final-review.json`
- its required JSON schema
- how a `REVISE` verdict's blockers get fixed and re-reviewed
- how an `APPROVE` verdict updates project status

This file (and the JSON review output once produced) is committed to the repository — it's part
of the release record, the same way `docs/DECISIONS.md` records every other consequential
decision. Do not gitignore it.
