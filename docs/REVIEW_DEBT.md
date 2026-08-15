# Review Debt

Tracks Codex reviews that are pending, deferred, or resulted in an unresolved disagreement
(`HUMAN_DECISION_REQUIRED`). Empty entries mean no debt.

| Milestone   | Item                                                          | Reason deferred                                                            | Status  |
| ----------- | -------------------------------------------------------------- | --------------------------------------------------------------------------- | ------- |
| M01-M04     | DB schema + FRED/ECOS adapter pattern                           | No Codex session available in this environment yet                          | PENDING |
| M04         | ECOS missing-value marker unverified against a live API response | Network access to ecos.bok.or.kr blocked in dev; needs real ECOS_API_KEY (Human Gate) to confirm | PENDING |
