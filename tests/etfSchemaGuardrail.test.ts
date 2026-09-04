import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Structural enforcement of docs/LEGAL_GUARDRAILS.md's ETF/company-scoring prohibition: "No
 * single-number 'buy fitness' or investment-recommendation scores in V1." Rather than trust
 * every future PR to remember this, this test greps the actual schema source for forbidden
 * field names in the Etf/EtfHolding models — a real regression here means someone tried to add
 * exactly the kind of field the guardrail exists to prevent.
 */

const FORBIDDEN_PATTERNS = [/score/i, /rating/i, /recommend/i, /suitab/i, /fitness/i];

function extractModelBlock(schema: string, modelName: string): string {
  const match = schema.match(new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`));
  if (!match) {
    throw new Error(`Could not find "model ${modelName} {" block in schema.prisma`);
  }
  return match[1];
}

describe("ETF schema guardrail", () => {
  const schema = readFileSync(join(__dirname, "..", "prisma", "schema.prisma"), "utf-8");

  it("Etf model has no recommendation/score/rating/suitability field", () => {
    const block = extractModelBlock(schema, "Etf");
    for (const pattern of FORBIDDEN_PATTERNS) {
      expect(block).not.toMatch(pattern);
    }
  });

  it("EtfHolding model has no recommendation/score/rating/suitability field", () => {
    const block = extractModelBlock(schema, "EtfHolding");
    for (const pattern of FORBIDDEN_PATTERNS) {
      expect(block).not.toMatch(pattern);
    }
  });
});
