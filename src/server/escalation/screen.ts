/**
 * Content screen for anything about to be posted to the public escalation channel.
 *
 * The repository is publicly readable, so a comment is a publication. The rule has always been
 * that no key, credential, private user data, financial account detail or internal secret goes
 * into it — and until this file existed, that rule lived only in prose. A prohibition with no
 * mechanism is a prohibition that holds exactly as long as everyone remembers it.
 *
 * Two design choices worth stating, because both cost something.
 *
 * **It matches shapes, not values.** Nothing here reads a real secret to compare against; a screen
 * that loaded the environment in order to detect it would put the secret in the screening process
 * and defeat itself. Shape-matching over-flags — `sk-` followed by forty characters is sometimes
 * an example in prose — and over-flagging is the correct direction of error here. A false positive
 * costs a rewritten sentence. A false negative is permanent.
 *
 * **It fails closed and it fails loud.** `screenPublicComment` returns findings; the caller must
 * refuse to post when the list is non-empty. It deliberately does not offer to redact and post the
 * remainder, because a redaction that silently succeeds trains everyone to stop reading the
 * warning.
 */

export type ScreenCategory =
  | "CREDENTIAL"
  | "CONNECTION_STRING"
  | "PRIVATE_CONTACT"
  | "ENVIRONMENT_SECRET"
  | "AUTHORIZATION_HEADER";

export interface ScreenFinding {
  category: ScreenCategory;
  /** What matched, in words. Never the matched text — that would copy the secret into the log. */
  reason: string;
  /** 1-indexed line of the comment body, so a human can find it without a search. */
  line: number;
}

interface Rule {
  category: ScreenCategory;
  pattern: RegExp;
  reason: string;
}

const RULES: Rule[] = [
  {
    category: "AUTHORIZATION_HEADER",
    // The scheme must be followed by something value-shaped. `Bearer $GITHUB_TOKEN` is a shell
    // variable reference and appears in the staged escalation queue, which is how this exclusion
    // was found: the first version flagged the queue's own worked example of how to post.
    //
    // Showing the SHAPE of a request is the normal way to describe a transport problem, and a
    // screen that forbids it forces the description into some channel with no screen at all.
    pattern:
      /\bauthorization\s*:\s*(bearer|basic|token)\s+(?!\$|\{|<|%|\.\.\.|x{3,}|["']?(your|placeholder|redacted|token\b))["']?[^\s"']{8,}/i,
    reason: "An Authorization header carrying what looks like a real credential value.",
  },
  {
    category: "CREDENTIAL",
    // GitHub's own token prefixes. These are documented and stable, which makes them the one
    // family this screen can recognise with near-certainty rather than by resemblance.
    pattern: /\bgh[pousr]_[A-Za-z0-9]{16,}/,
    reason: "A GitHub token prefix followed by token-shaped characters.",
  },
  {
    category: "CREDENTIAL",
    pattern: /\bsk-[A-Za-z0-9_-]{20,}/,
    reason: "An OpenAI-style secret key prefix followed by key-shaped characters.",
  },
  {
    category: "CREDENTIAL",
    pattern: /\bsk-ant-[A-Za-z0-9_-]{16,}/,
    reason: "An Anthropic secret key prefix followed by key-shaped characters.",
  },
  {
    category: "CONNECTION_STRING",
    // The password position specifically. A connection string with no password in it is a piece
    // of configuration; one with a password in it is a credential, and only the second matters.
    pattern: /\b(postgres|postgresql|mysql|mongodb|redis|amqp)(\+\w+)?:\/\/[^\s:@/]+:[^\s@/]+@/i,
    reason: "A database URL carrying a password in the userinfo position.",
  },
  {
    category: "ENVIRONMENT_SECRET",
    // An assignment to a secret-sounding name with a non-placeholder value. The placeholder
    // exclusion is what keeps this usable: `.env.example` lines and documentation are the normal
    // way to DISCUSS a variable, and a screen that blocks discussing them blocks the escalation.
    pattern:
      /\b[A-Z][A-Z0-9_]*(KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL)\s*[=:]\s*(?!["']?(your|xxx|placeholder|changeme|example|<|\.\.\.|\*+|""|''|$))["']?[^\s"']{8,}/,
    reason: "An assignment to a secret-named variable with what looks like a real value.",
  },
  {
    category: "PRIVATE_CONTACT",
    // A real address belonging to a person, as distinct from the noreply and example addresses
    // that appear legitimately in commit trailers and documentation.
    pattern:
      /\b[A-Za-z0-9._%+-]+@(?!(example|test|localhost)\.)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b(?<!noreply@anthropic\.com)/,
    reason: "An email address that is not an example or a noreply address.",
  },
];

/**
 * Screen a comment body. An empty result means the text may be posted; anything else means it
 * may not.
 */
export function screenPublicComment(body: string): ScreenFinding[] {
  const findings: ScreenFinding[] = [];
  const lines = body.split(/\r?\n/);

  lines.forEach((text, index) => {
    for (const rule of RULES) {
      if (rule.pattern.test(text)) {
        findings.push({ category: rule.category, reason: rule.reason, line: index + 1 });
      }
    }
  });

  return findings;
}

/**
 * The caller-facing form: a boolean plus the reason it is false.
 *
 * Separate from `screenPublicComment` so that the decision to post is a single expression at the
 * call site rather than a length check somebody can get backwards.
 */
export function mayPostPublicly(body: string): { allowed: boolean; findings: ScreenFinding[] } {
  const findings = screenPublicComment(body);
  return { allowed: findings.length === 0, findings };
}
