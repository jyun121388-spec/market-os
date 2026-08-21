import { SOURCES } from "../../../prisma/sources";
import { CAUSAL_EDGES } from "../../../prisma/causalEdges";

/**
 * Deciding whether the subject of a trading verb is a PERSON, and failing safe when it cannot tell.
 *
 * Thirteen review rounds went into `askMarket.ts` trying to make a pattern list answer one
 * question: in "Should X buy Nvidia?", is X somebody being advised, or something being analysed?
 * Every attempt keyed on a surface feature standing in for the answer — a possessive pronoun, then
 * a kinship list, then a capital letter, then a role list — and each one was walked past from one
 * side or refused ordinary research from the other. The record is in
 * `docs/INTERIM_REVIEW_FINDINGS.md`; the shortest version is that "Should John buy Nvidia?" and
 * "Should Apple buy Nvidia?" are the same shape, and no amount of pattern work distinguishes them,
 * because the difference is not in the sentence. It is in what John and Apple ARE.
 *
 * So this module answers that question directly, and answers it with three values rather than two.
 * UNRESOLVED is the important one: a capitalised subject that no registry recognises is not
 * thereby a company, and in a direct transactional frame it redirects. That is the fail-safe
 * direction, and it is the whole reason a classifier beats a pattern here — a pattern has to
 * decide, and this can decline to.
 *
 * Deterministic and local. No network, no model, no runtime cost beyond a set lookup. The
 * registries below come from data this repository already keeps, plus one curated set for the
 * entities that ordinary market questions name constantly and that no table in v1 holds yet.
 */

export type SubjectClass = "PERSON" | "NON_PERSON" | "UNRESOLVED";

/**
 * Words that make the subject a person outright, whatever else the sentence contains.
 *
 * Kinship, the first and second person, and the roles whose job is to act on somebody's behalf.
 * The role list is inherited from the rounds that built it: a broker or a trustee acts FOR a
 * person, so advising one is advising them.
 */
const PERSON_WORDS = new Set(
  [
    "i",
    "me",
    "my",
    "mine",
    "myself",
    "we",
    "us",
    "our",
    "you",
    "your",
    "he",
    "him",
    "his",
    "she",
    "her",
    "hers",
    "they",
    "them",
    "their",
    "dad",
    "mom",
    "mum",
    "mother",
    "father",
    "parents",
    "brother",
    "sister",
    "son",
    "daughter",
    "wife",
    "husband",
    "partner",
    "spouse",
    "friend",
    "uncle",
    "aunt",
    "grandma",
    "grandpa",
    "grandmother",
    "grandfather",
    "colleague",
    "boss",
    "client",
    "neighbour",
    "neighbor",
    "trustee",
    "broker",
    "adviser",
    "advisor",
    "banker",
    "accountant",
    "custodian",
    "fiduciary",
  ].map((word) => word.toLowerCase()),
);

/**
 * Job words that are only a financial agent when a financial qualifier says so.
 *
 * "Manager" and "agent" name half the jobs there are. An INVESTMENT manager acts on somebody's
 * portfolio; a PROJECT manager buys software, an ESTATE agent sells houses, an OFFICE manager buys
 * desks — and all three were refused for a round when the head noun alone was taken as evidence.
 * A broker or a trustee needs no qualifier because the title already says what the job is; these
 * do.
 */
const GENERIC_ROLE_HEADS = new Set([
  "manager",
  "agent",
  "planner",
  "consultant",
  "counsel",
  "coordinator",
  "supervisor",
  "assistant",
  "secretary",
  "officer",
  "director",
]);

const FINANCE_QUALIFIERS = new Set([
  "investment",
  "investments",
  "financial",
  "finance",
  "wealth",
  "money",
  "portfolio",
  "fund",
  "asset",
  "assets",
  "retirement",
  "pension",
  "tax",
  "securities",
  "brokerage",
]);

/**
 * Head nouns that make a subject an ORGANISATION even when the words around them look personal.
 *
 * "My brother's company" is a company; "my brother's broker" is my brother. Both are possessive,
 * both name a relative, and the head noun is the only thing that separates them — a distinction
 * two separate review rounds arrived at from opposite directions before it was written down here.
 */
const ORGANISATION_WORDS = new Set([
  "company",
  "companies",
  "corporation",
  "corp",
  "firm",
  "business",
  "bank",
  "banks",
  "fund",
  "funds",
  "index",
  "indices",
  "exchange",
  "regulator",
  "government",
  "ministry",
  "agency",
  "board",
  "committee",
  "central",
  "treasury",
  "issuer",
  "borrower",
  "insurer",
  "startup",
  "subsidiary",
  "division",
  "unit",
  "market",
  "markets",
  "industry",
  "sector",
  "investors",
  "shareholders",
  "holders",
  "traders",
  "consumers",
  "households",
  "employers",
  "association",
  "institute",
  "federation",
  "society",
  "council",
  "authority",
  "consortium",
  "alliance",
]);

/**
 * Entities the product talks about by name, normalised to lower case.
 *
 * Three of these come from data the repository already maintains — the provider institutions in
 * `prisma/sources.ts`, the macro variables in `prisma/causalEdges.ts`, and the market indices that
 * had accumulated inside a guardrail regex and are now a named set. The fourth is curated: the
 * companies, countries and policy actors that market questions name constantly and that no v1
 * table holds, because `filings.corpName` contains two companies until an ingest runs and a
 * classifier that depends on ingestion state would answer differently on two machines.
 *
 * Curated, closed and small on purpose. The argument for enumerating indices — that the set can be
 * FINISHED, unlike personal names — applies here too, and where it does not the answer is
 * UNRESOLVED rather than a guess.
 */
const MARKET_INDICES = [
  "s&p",
  "s&p 500",
  "sp500",
  "nasdaq",
  "dow",
  "dow jones",
  "russell",
  "kospi",
  "kosdaq",
  "nikkei",
  "ftse",
  "dax",
  "hang seng",
  "stoxx",
  "vix",
];

const POLICY_ACTORS = [
  "fed",
  "federal reserve",
  "fomc",
  "ecb",
  "european central bank",
  "boj",
  "bank of japan",
  "bok",
  "bank of korea",
  "boe",
  "bank of england",
  "pboc",
  "congress",
  "parliament",
  "senate",
  "imf",
  "world bank",
  "oecd",
  "opec",
  "sec",
  "fdic",
  "finra",
  "cftc",
];

const PLACES = [
  "us",
  "usa",
  "america",
  "korea",
  "japan",
  "china",
  "europe",
  "eu",
  "uk",
  "britain",
  "germany",
  "france",
  "india",
  "brazil",
  "canada",
  "australia",
  "taiwan",
  "vietnam",
  "mexico",
  "russia",
  "asia",
];

/**
 * Companies named often enough in market questions to be worth knowing by name.
 *
 * The bar for entry is that a question naming this company is ordinary research rather than a
 * request for advice. Anything not here classifies UNRESOLVED, which redirects — so the cost of
 * omission is an over-block on one phrasing, and the cost of a wrong entry is a prohibited answer.
 * Erring toward a short list is the safe direction.
 */
const WELL_KNOWN_COMPANIES = [
  "apple",
  "microsoft",
  "google",
  "alphabet",
  "amazon",
  "meta",
  "facebook",
  "nvidia",
  "tesla",
  "netflix",
  "intel",
  "amd",
  "qualcomm",
  "broadcom",
  "oracle",
  "salesforce",
  "ibm",
  "cisco",
  "adobe",
  "berkshire",
  "berkshire hathaway",
  "blackrock",
  "vanguard",
  "fidelity",
  "jpmorgan",
  "goldman",
  "goldman sachs",
  "morgan stanley",
  "citigroup",
  "wells fargo",
  "samsung",
  "hyundai",
  "lg",
  "sk hynix",
  "naver",
  "kakao",
  "posco",
  "celltrion",
  "tsmc",
  "toyota",
  "sony",
  "softbank",
  "alibaba",
  "tencent",
  "asml",
  "nestle",
  "novartis",
  "shell",
  "bp",
  "exxon",
  "chevron",
  "boeing",
  "airbus",
  "pfizer",
  "moderna",
  "walmart",
  "costco",
  "disney",
  "starbucks",
  "nike",
  "mcdonalds",
  "coca-cola",
  "pepsico",
  "visa",
  "mastercard",
  "paypal",
  "uber",
  "airbnb",
];

/** Every non-person name, lower-cased, in one set. Built once. */
const NON_PERSON_NAMES: ReadonlySet<string> = new Set([
  ...MARKET_INDICES,
  ...POLICY_ACTORS,
  ...PLACES,
  ...WELL_KNOWN_COMPANIES,
  // Institutions the repository already enumerates, by code and by name.
  ...SOURCES.flatMap((source) => [source.code.toLowerCase(), source.name.toLowerCase()]),
  // Macro variables the causal graph already names — "oil price (WTI)" and the rest. Split on
  // punctuation so "VIX (equity volatility index)" contributes "vix" as well as the whole string.
  ...CAUSAL_EDGES.flatMap((edge) =>
    [edge.fromVariable, edge.toVariable].flatMap((variable) => [
      variable.toLowerCase(),
      ...variable.toLowerCase().split(/[()/,]+/),
    ]),
  ),
]);

/** Words that carry no evidence either way and should not stop the scan. */
const NEUTRAL_WORDS = new Set([
  "the",
  "a",
  "an",
  "this",
  "that",
  "these",
  "those",
  "any",
  "some",
  "each",
  "every",
  "new",
  "old",
  "big",
  "small",
  "large",
  "major",
  "minor",
  "senior",
  "junior",
  "independent",
  "private",
  "public",
  "elderly",
  "retired",
  "young",
]);

/** Tokens, lower-cased, punctuation stripped, possessives reduced to the noun. */
function tokenise(subject: string): string[] {
  return subject
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .split(/[^a-z0-9&-]+/)
    .filter((token) => token.length > 0);
}

/**
 * What the subject of a trading verb is.
 *
 * Order matters and encodes a judgement. ORGANISATION head nouns win over person words, because
 * "my brother's company" is a company and the possessive is a red herring. Person words win over
 * everything else, because a broker or a father in the subject settles it. A recognised name is
 * NON_PERSON. Anything left — a capitalised word no registry knows, most obviously a first name —
 * is UNRESOLVED, and callers are expected to treat that as a person.
 */
/**
 * The segment of a phrase that actually governs it: whatever follows the last possessive.
 *
 * "The bank's TRUSTEE" is a person and "my brother's COMPANY" is a company, and in both the words
 * before the apostrophe say who owns the thing rather than what it is. Scanning the whole phrase
 * gets the first of those wrong — "bank" is in it — which is how a personalised request about a
 * bank's trustee came to be answered.
 *
 * Without a possessive the whole phrase governs, which is what keeps "the bank where my father
 * works" an organisation: no apostrophe, so nothing is being owned, and "bank" is simply in it.
 */
function governingSegment(phrase: string): string {
  const parts = phrase.split(/['’]s\b/);
  return parts.length > 1 ? parts[parts.length - 1] : phrase;
}

export function classifySubject(subject: string): SubjectClass {
  // Only the HEAD phrase decides. An appositive after a comma describes the subject; it is not the
  // subject. "My father, a company DIRECTOR, sell Apple?" put an organisation word in reach of a
  // rule that checks organisation words first, and answered a personalised request — while "my
  // brother's company, given its strong cash balance" needs the organisation word to win, because
  // there it IS the head. Splitting at the comma separates the two without a new list.
  const head = governingSegment(subject.split(",")[0]);
  const headTokens = tokenise(head);
  if (headTokens.length > 0) {
    const fromHead = classifyTokens(headTokens);
    if (fromHead !== "UNRESOLVED") return fromHead;
  }

  const tokens = tokenise(subject);
  if (tokens.length === 0) return "UNRESOLVED";
  return classifyTokens(tokens);
}

/** The classification rules themselves, applied to one already-tokenised phrase. */
function classifyTokens(tokens: string[]): SubjectClass {
  // A QUALIFIED financial role first, before the organisation words, because the two vocabularies
  // overlap: "fund" is an organisation on its own and a finance qualifier in "fund manager". With
  // the organisation check first, "Should the fund manager hold Tesla?" read as an institution.
  // The role has to be the HEAD — the last word of the phrase — not merely present in it. "The
  // fund manager association" is an association and "the fund manager" is a person, and
  // bag-of-words matching read the first as the second, refusing a question about industry policy.
  const hasRoleHead = GENERIC_ROLE_HEADS.has(tokens[tokens.length - 1]);
  const hasFinanceQualifier = tokens.some((token) => FINANCE_QUALIFIERS.has(token));
  if (hasRoleHead && hasFinanceQualifier) return "PERSON";

  if (tokens.some((token) => ORGANISATION_WORDS.has(token))) return "NON_PERSON";

  // An UNqualified generic job word, and it decides before the person words do — the possessive in
  // "my brother's project manager" is about my brother, and the subject is not.
  if (hasRoleHead) return "NON_PERSON";

  if (tokens.some((token) => PERSON_WORDS.has(token))) return "PERSON";

  // Multi-word names first, so "hang seng" and "goldman sachs" are not missed by a token scan.
  const joined = tokens.join(" ");
  if (NON_PERSON_NAMES.has(joined)) return "NON_PERSON";
  for (let start = 0; start < tokens.length; start += 1) {
    for (let end = start + 1; end <= tokens.length; end += 1) {
      if (NON_PERSON_NAMES.has(tokens.slice(start, end).join(" "))) return "NON_PERSON";
    }
  }

  // Everything that is left is either a name nobody has registered or ordinary words. If it is all
  // neutral filler there is nothing to classify; otherwise it is an unrecognised name.
  if (tokens.every((token) => NEUTRAL_WORDS.has(token))) return "UNRESOLVED";
  return "UNRESOLVED";
}

/**
 * The direct transactional frame this classifier exists for: `should <subject> <trading verb>`.
 *
 * Deliberately narrow. It matches only where a subject sits between "should" and a trading verb in
 * one clause, which is the construction every round of this problem has been about. Everything
 * else in the guardrail stays where it is.
 */
// Commas are allowed inside the subject, because the description of a person is exactly where one
// appears: "Should my elderly retired father, given his low risk tolerance, sell Apple?" is
// forty-eight characters of subject with two commas in it. Bounding at seventy characters is what
// keeps the span local, and the classifier — not the punctuation — decides what the subject is.
const TRANSACTIONAL_FRAME =
  /\bshould\s+([^?!]{1,120}?)\s+\b(buy|sell|dump|short|hold|invest|purchase|liquidate|divest)\b/i;

/**
 * Whether a query asks whether a PERSON should trade.
 *
 * True for a recognised person and for an unrecognised subject; false only when the subject is
 * something the registries identify as not a person. That asymmetry is the fail-safe: an
 * unrecognised name redirects.
 */
/** Words naming a tradable thing, as opposed to office furniture or a house. */
const FINANCIAL_OBJECT_WORDS = new Set([
  "shares",
  "share",
  "stock",
  "stocks",
  "equity",
  "equities",
  "bond",
  "bonds",
  "etf",
  "etfs",
  "fund",
  "funds",
  "position",
  "positions",
  "stake",
  "holding",
  "holdings",
  "portfolio",
  "securities",
  "options",
  "futures",
  "treasuries",
  "crypto",
  "bitcoin",
]);

/**
 * Whether what is being bought or sold is a tradable instrument.
 *
 * The subject alone is not enough, and two findings from opposite directions prove it. "Should my
 * brother's PROJECT MANAGER buy new software?" is procurement; "Should my brother's PROJECT MANAGER
 * buy Nvidia?" is a personalised trade. Same subject, same verb, and only the object differs — so
 * a rule that reads only the subject has to get one of them wrong.
 */
function objectIsFinancial(object: string): boolean {
  const tokens = tokenise(object);
  if (tokens.some((token) => FINANCIAL_OBJECT_WORDS.has(token))) return true;
  const joined = tokens.join(" ");
  if (NON_PERSON_NAMES.has(joined)) return true;
  for (let start = 0; start < tokens.length; start += 1) {
    for (let end = start + 1; end <= tokens.length; end += 1) {
      if (NON_PERSON_NAMES.has(tokens.slice(start, end).join(" "))) return true;
    }
  }
  return false;
}

/**
 * Whether the subject names a person anywhere in it, even if something else is its head.
 *
 * A person NOUN, not a possessive pronoun. "Our independent central bank" contains "our" and names
 * no one; "my brother's project manager" contains "brother" and does. Using the whole person-word
 * set here refused a monetary-policy question, because the pronoun that makes a subject personal
 * in one construction is just a determiner in the other.
 */
const PERSON_NOUNS = new Set(
  [...PERSON_WORDS].filter(
    (word) =>
      ![
        "i",
        "me",
        "my",
        "mine",
        "myself",
        "we",
        "us",
        "our",
        "you",
        "your",
        "he",
        "him",
        "his",
        "she",
        "her",
        "hers",
        "they",
        "them",
        "their",
      ].includes(word),
  ),
);

/**
 * Personal evidence in the subject's HEAD, used only to rescue a NON_PERSON head.
 *
 * The head, not the whole subject: "Should BlackRock, whose CLIENT base is aging, sell Treasury
 * bonds?" is institutional research, and reading the appositive found a person noun in it. Same
 * rule as `classifySubject` — what follows a comma describes the subject and is not the subject.
 *
 * A personal possessive counts as well as a person noun, because "my retirement fund" and "your
 * retirement fund" are somebody's own money and no noun in either says so. "Our" deliberately does
 * not: it makes a subject personal in "our portfolio" and is a bare determiner in "our independent
 * central bank", and the second of those is a monetary-policy question this refused for one round.
 */
// Second person belongs here too: "your retirement fund" is the reader's money as plainly as
// "my retirement fund" is mine. Only "our" is left out, and only because it is the one
// possessive that reads institutionally — "our independent central bank".
const PERSONAL_POSSESSIVES = new Set(["i", "me", "my", "mine", "myself", "you", "your", "yours"]);

/**
 * Whether the subject is an organisation, ignoring a personal possessive in front.
 *
 * "The trustee bank" contains an organisation word and is one, even though "trustee" names a
 * person. "My retirement fund" contains one too, and the possessive says it is somebody's. That
 * difference — an article in front versus a personal possessive — is the whole distinction, and it
 * is what stopped "Should the trustee bank sell THEIR pension fund business?" being read as a
 * personalised trade.
 *
 * It looks anywhere in the head phrase rather than at the last word, which it did for one commit.
 * A relative clause moves the last word off the institution: "the bank where my father WORKS" ends
 * in a verb, and reading only the end made the bank invisible and the father decisive. That is not
 * true of the ROLE check further up, where the last word genuinely is the head — "the fund manager
 * association" is an association — so the two checks read the phrase differently on purpose.
 */
function headIsAnOrganisation(subject: string): boolean {
  const whole = tokenise(subject.split(",")[0]);
  if (whole.length === 0) return false;
  if (PERSONAL_POSSESSIVES.has(whole[0])) return false;
  // Only what the possessive governs. "The bank's trustee" is a trustee.
  const head = tokenise(governingSegment(subject.split(",")[0]));
  return head.some((token) => ORGANISATION_WORDS.has(token));
}

function mentionsAPerson(subject: string): boolean {
  const head = tokenise(subject.split(",")[0]);
  return head.some((token) => PERSON_NOUNS.has(token) || PERSONAL_POSSESSIVES.has(token));
}

export function asksWhetherAPersonShouldTrade(query: string): boolean {
  const frame = TRANSACTIONAL_FRAME.exec(query);
  if (!frame) return false;
  const subject = frame[1];
  const verb = frame[2].toLowerCase();

  // "Should my model hold the discount rate constant" is methodology, and the analytical sense of
  // "hold" has been an over-block in three separate rounds. Handled here rather than in the
  // classifier, because it is a property of the SENTENCE and not of the subject.
  // "Short" is an adjective as often as a verb in this domain. "What should a 10-K disclose about
  // SHORT POSITIONS?" is a disclosure question, and reading "short" as the trading verb there puts
  // "a 10-K disclose about" in the subject slot, where nothing recognises it and the fail-safe
  // redirects a perfectly ordinary question.
  if (verb === "short") {
    const after = query.slice(frame.index + frame[0].length);
    if (
      /^\s*(position|positions|interest|seller|sellers|selling|squeeze|sale|sales)\b/i.test(after)
    )
      return false;
  }

  const object = query.slice(frame.index + frame[0].length, frame.index + frame[0].length + 60);
  const financialObject = objectIsFinancial(object);

  // The analytical sense of "hold" — holding a variable constant — but ONLY when the thing held is
  // not tradable. "Should my father hold his Apple position unchanged?" contains "unchanged" and
  // is a personalised hold recommendation; "Should my model hold the discount rate fixed?" is
  // methodology. The qualifier alone cannot tell them apart, and the object can.
  if (verb === "hold" && !financialObject) {
    if (/\b(constant|fixed|steady|equal|unchanged)\b/i.test(object.slice(0, 40))) return false;
  }

  // A singular personal possessive on the object settles it whatever the subject is. "Should Apple
  // Martin sell HER Nvidia shares?" is a person's holding being sold, and the subject — a name that
  // happens to collide with a company — cannot be trusted to say so. "His" and "her" only: "their"
  // and "our" are what organisations take, which is how "Should BlackRock sell their pension fund
  // business?" stays answerable.
  if (financialObject && /\b(his|her)\b/i.test(object)) return true;

  const subjectClass = classifySubject(subject);
  if (subjectClass !== "NON_PERSON") return true;

  // The subject's HEAD is not a person, but a person is named in it and what is being traded is an
  // instrument. "Should my brother's project manager buy Nvidia?" is a personalised trade;
  // "Should my brother's project manager buy new software?" is procurement. Same subject, same
  // verb — the object is the only thing that separates them, so it decides.
  // ...unless the object belongs to the organisation. "Should the trustee bank hold ITS pension
  // fund assets separately?" has a person noun in the subject and a tradable object, and is a
  // question about an institution's balance sheet. "Its" and "their" say whose the holding is, and
  // an organisation's holding is not a personalised trade.
  //
  // "Its" only. "Their" was here for one commit and is ordinary singular-they — "Should Dad's
  // assistant sell THEIR Nvidia shares?" is one person's holding.
  //
  // The reasoning written here when "their" was dropped said the organisational cases have no
  // person noun in the subject, so the rescue could never reach this line for them. That was
  // WRONG, and the next review disproved it in one line: "Should the trustee bank sell their
  // Nvidia holdings?" has "trustee" in the subject. The claim was too strong and the check that
  // now carries it is `headIsAnOrganisation` below — a property of the subject, not a hope about
  // which subjects occur.
  if (/\bits\b/i.test(object)) return false;

  return mentionsAPerson(subject) && financialObject && !headIsAnOrganisation(subject);
}
