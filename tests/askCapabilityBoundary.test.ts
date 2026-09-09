import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Ask page now tells a user, in as many words, that no answer-writing model is configured and
 * that Market OS "will not silently reach for one". That is a CLAIM about this software, and a
 * claim in user-facing copy needs the same treatment as a claim about a number: something has to
 * check it.
 *
 * Observing that no request went out would prove it for one query on one day. These controls are
 * structural instead — they assert there is no code path that could make such a call at all, which
 * is the stronger statement and the one the sentence actually makes.
 *
 * `askMarketInference.ts` deliberately DECLARES an `InferenceSink` interface so the safety boundary
 * exists before a provider does. Declaring it is fine. Implementing it is what would make the
 * sentence false.
 */

const SRC = join(process.cwd(), "src");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const FILES = sourceFiles(SRC).map((path) => ({
  path: path.slice(process.cwd().length + 1).replace(/\\/g, "/"),
  text: readFileSync(path, "utf8"),
}));

/** Every SDK that would put a model behind a paid credential. */
const MODEL_SDKS = [
  "openai",
  "@anthropic-ai",
  "@google/generative-ai",
  "@google-cloud/aiplatform",
  "@aws-sdk/client-bedrock",
  "cohere",
  "mistralai",
  "replicate",
  "ollama",
  "langchain",
];

describe("the Ask capability statement is structurally true", () => {
  it("finds the source tree at all, so a green result means something", () => {
    // A file walker that returned nothing would satisfy every assertion below by vacuity — the
    // same shape of defect as the vacuous `every()` on an empty array that hid a P1 in IR-133.
    expect(FILES.length).toBeGreaterThan(50);
    expect(FILES.some((f) => f.path === "src/server/domain/askMarketInference.ts")).toBe(true);
  });

  it("declares InferenceSink but implements it nowhere", () => {
    const declaring = FILES.filter((f) => /export interface InferenceSink\b/.test(f.text));
    expect(declaring.map((f) => f.path)).toEqual(["src/server/domain/askMarketInference.ts"]);

    // An implementation is what would make the page's sentence false. Anything that satisfies the
    // contract has to define `generatePlan`, so that is what is searched for — outside the one
    // file allowed to name it in a type.
    const implementing = FILES.filter(
      (f) =>
        f.path !== "src/server/domain/askMarketInference.ts" &&
        /\bgeneratePlan\s*[(:]/.test(f.text),
    );
    expect(
      implementing.map((f) => f.path),
      "something implements the model sink, so the page's claim that none is configured is false",
    ).toEqual([]);
  });

  it("imports no model SDK anywhere in the product", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      for (const sdk of MODEL_SDKS) {
        // Import forms only. A comment or a string naming a provider is discussion, and this
        // repository discusses them constantly — flagging that would be flagging documentation.
        const pattern = new RegExp(
          `(?:from|import|require)\\s*\\(?\\s*["'\`]${sdk.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}`,
        );
        if (pattern.test(file.text)) offenders.push(`${file.path} -> ${sdk}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("declares no model SDK as a dependency", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    for (const sdk of MODEL_SDKS) {
      expect(
        declared.filter((d) => d === sdk || d.startsWith(`${sdk}/`)),
        `${sdk} is installed, so a model call is one import away`,
      ).toEqual([]);
    }
  });

  it("never reads a model credential from the environment", () => {
    // The keys this repository legitimately reads are data-provider keys and the database URL.
    // A model credential appearing in `process.env` anywhere would mean somebody wired a provider
    // without going through HG-006.
    const modelEnvVars = [
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "GOOGLE_API_KEY",
      "GEMINI_API_KEY",
      "AWS_BEDROCK",
      "AZURE_OPENAI",
    ];
    const offenders: string[] = [];
    for (const file of FILES) {
      for (const key of modelEnvVars) {
        if (new RegExp(`process\\.env\\.${key}\\b|process\\.env\\[["'\`]${key}`).test(file.text)) {
          offenders.push(`${file.path} -> ${key}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the Ask page offers a normal user no terminal instruction", () => {
    const page = FILES.find((f) => f.path === "src/app/ask/page.tsx");
    expect(page, "the Ask page must exist").toBeDefined();
    // Rendered copy only — the file's own comments discuss `.env` and code identifiers, and
    // flagging those would be flagging the explanation of why the copy says what it says.
    const rendered = page!.text
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^\s*\/\/.*$/gm, " ")
      .replace(/className="[^"]*"/g, " ");
    for (const forbidden of [
      "npm ",
      "npx ",
      ".env",
      "PowerShell",
      "powershell",
      "Prisma",
      "VS Code",
      "Claude Code",
      "API key",
    ]) {
      expect(rendered.includes(forbidden), `Ask page copy must not say "${forbidden}"`).toBe(false);
    }
  });
});
