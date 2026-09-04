"""M-GH: can the real transport be talked into confirming something GitHub did not say?

WRITE/EDIT TOOL ONLY -- heredocs in this environment eat backslashes, and two anchors are regexes.

`gh-transport.ts` is the only thing that turns a remote answer into evidence. Its one hazardous
property is that it could ECHO its own arguments back: if `readBack` reported the repository and
issue it was CONSTRUCTED with rather than the ones the response names, every binding clause in
`isTransmitted` would be vacuous -- a comment on any issue anywhere would satisfy a proof that says
"this came from the repository we asked about" because we told it so.

Expected cardinalities, written before the run:

  M-GH-ECHO-COORDINATES      answer with the canonical repository and issue whatever the response
                             said
                             -> 2 red: the takes-it-from-the-issue_url control and the
                                cannot-parse control. Both hold the constructor arguments constant
                                and vary only what the response says, which is the whole point.

  M-GH-TAG-ONLY              match an existing comment on its protocol tag alone
                             -> 1 red: the find-by-digest control. This channel carries many
                                comments per protocol id -- every rework round posts one -- so tag
                                matching adopts the WRONG comment and records a proof describing a
                                body that was never sent.

  M-GH-NO-PAGINATE           scan only the first page
                             -> 3 red: all three find controls, because the fixture exec refuses an
                                invocation it does not recognise. A first-page-only scan answers
                                "not there" about a comment that is, which posts a duplicate.

  M-GH-INVENT-COMMENT-ID     fall back to a number when the post prints no comment URL
                             -> 2 red: the URL-parsing control and the refuses-to-invent control. A
                                fabricated id reads back as nothing and records a refusal for the
                                wrong reason, hiding a broken post behind a plausible message.

  M-GH-ANY-COMMENT-ID        accept any id shape from the response
                             -> 1 red: the malformed-id control.

    python scripts/mutation/ghtransport.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from harness import harness

GH = "scripts/gh-transport.ts"
TEST = "tests/ghTransport.test.ts"

BINDING_TESTS = [TEST]
UNRELATED_TESTS = ["tests/evolutionScheduler.test.ts"]

MUTATIONS = [
    (
        "M-GH-ECHO-COORDINATES the transport answers with its own arguments",
        GH,
        "  const match = /\\/repos\\/([^/]+\\/[^/]+)\\/issues\\/(\\d+)(?:$|[?#])/.exec(issueUrl);\n"
        "  if (!match) return null;",
        "  const match = /\\/repos\\/([^/]+\\/[^/]+)\\/issues\\/(\\d+)(?:$|[?#])/.exec(issueUrl);\n"
        '  if (!match) return { repository: "jyun121388-spec/market-os", issueNumber: 2 };',
    ),
    (
        "M-GH-TAG-ONLY an existing comment matches on its protocol tag alone",
        GH,
        "        if (bodyDigest(payload.body) !== digest) continue;\n",
        "",
    ),
    (
        "M-GH-NO-PAGINATE only the first page of comments is scanned",
        GH,
        'const raw = exec(["api", commentsPath, "--paginate"]);',
        'const raw = exec(["api", commentsPath]);',
    ),
    (
        "M-GH-INVENT-COMMENT-ID a post with no comment URL still yields an id",
        GH,
        "  const match = /#issuecomment-(\\d+)\\s*$/.exec(url.trim());\n  if (!match) return null;",
        "  const match = /#issuecomment-(\\d+)\\s*$/.exec(url.trim());\n  if (!match) return 1;",
    ),
    (
        "M-GH-ANY-COMMENT-ID any id shape in the response is accepted",
        GH,
        "  if (!Number.isInteger(payload.id) || payload.id <= 0) return null;\n",
        "",
    ),
]

sys.exit(harness([GH], BINDING_TESTS, UNRELATED_TESTS, MUTATIONS, wall_seconds=900))
