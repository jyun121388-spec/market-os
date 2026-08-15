# Review Debt

Tracks Codex reviews that are pending, deferred, or resulted in an unresolved disagreement
(`HUMAN_DECISION_REQUIRED`). Empty entries mean no debt.

| Milestone | Item                                                                    | Reason deferred                                                                                        | Status  |
| --------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ------- |
| M01-M06   | DB schema + FRED/ECOS/DART/EDGAR adapter pattern                         | No Codex session available in this environment yet                                                    | PENDING |
| M04       | ECOS missing-value marker unverified against a live API response         | Network access to ecos.bok.or.kr blocked in dev; needs real ECOS_API_KEY (Human Gate) to confirm      | PENDING |
| M05       | OpenDART list.json field names/status codes unverified against live API  | Network access to opendart.fss.or.kr blocked in dev; needs real DART_API_KEY (Human Gate) to confirm  | PENDING |
| M06       | EDGAR submissions.json field names unverified against live API           | Network access to data.sec.gov blocked in dev; built from SEC's published docs via web search only   | PENDING |
