/**
 * M27 Production QA — a single persistent, version-controlled end-to-end walkthrough of the
 * real user path, run with a real browser against a real running `npm run dev` server. Every
 * prior milestone verified its own slice individually (M20 Today, M22 Auth, M24 Admin, M26
 * lockout); this exercises them together in one continuous session, the way an actual user
 * would move through the app, asserting on real rendered content at each step.
 *
 * Prerequisites: `npm run dev` running on http://localhost:3000, DATABASE_URL set.
 * Usage: DATABASE_URL=... npx tsx scripts/e2e-full-walkthrough.ts
 */
import { chromium } from "playwright";
import { prisma } from "../src/server/db/client";

const BASE_URL = "http://localhost:3000";
const TEST_EMAIL = "e2e-walkthrough@example.com";
const PASSWORD = "correct-horse-battery-staple";

let failures = 0;

function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}`);
    failures += 1;
  }
}

async function cleanupTestUser() {
  const existing = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
  if (existing) {
    await prisma.session.deleteMany({ where: { userId: existing.id } });
    await prisma.watchlistItem.deleteMany({ where: { userId: existing.id } });
    await prisma.user.delete({ where: { id: existing.id } });
  }
}

async function main() {
  await cleanupTestUser();

  // The browser binary location is environment-specific: the cloud dev sandbox ships a
  // pre-installed Chromium at a fixed path, while a local machine uses Playwright's own
  // download cache. Hardcoding either one makes this script unrunnable in the other, so the
  // path is opt-in via PLAYWRIGHT_CHROMIUM_PATH and otherwise left to Playwright to resolve.
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const page = await browser.newPage();

  try {
    console.log("[1] Unauthenticated /admin redirects to /login");
    await page.goto(`${BASE_URL}/admin`);
    await page.waitForURL("**/login", { timeout: 10000 });
    check("redirected to /login", page.url() === `${BASE_URL}/login`);

    console.log("[2] Sign up a new user");
    await page.goto(`${BASE_URL}/signup`);
    await page.fill('input[name="email"]', TEST_EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/today", { timeout: 10000 });
    let body = await page.textContent("body");
    check("on /today after signup", page.url() === `${BASE_URL}/today`);
    check("shows signed-in email", (body ?? "").includes(TEST_EMAIL));

    console.log("[3] Session cookie is a random 64-char hex token with correct flags");
    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === "market_os_session");
    check("session cookie exists", Boolean(sessionCookie));
    check("session cookie is httpOnly", sessionCookie?.httpOnly === true);
    check("session cookie sameSite is Lax", sessionCookie?.sameSite === "Lax");
    check("session token is 64-char hex", /^[0-9a-f]{64}$/.test(sessionCookie?.value ?? ""));

    console.log("[4] Authenticated /admin shows pipeline health");
    await page.goto(`${BASE_URL}/admin`);
    body = await page.textContent("body");
    check("shows Pipeline Health heading", (body ?? "").includes("Pipeline Health"));
    check("shows signed-in email on /admin", (body ?? "").includes(TEST_EMAIL));
    // Ingest completeness is the operator-facing answer to "is the stored data complete?".
    // Every adapter reports a truncation flag now; this is the surface that makes it readable
    // rather than a console line nobody sees.
    check("shows the Ingest completeness section", (body ?? "").includes("Ingest completeness"));
    check(
      "explains what fetched-vs-provider means rather than showing a bare number",
      (body ?? "").includes("what the provider itself said exists"),
    );

    console.log("[5] Watchlist: add, see it listed, remove it");
    await page.goto(`${BASE_URL}/watchlist`);
    body = await page.textContent("body");
    check("watchlist starts empty", (body ?? "").includes("Nothing tracked yet"));

    await page.selectOption('select[name="itemType"]', "INDICATOR");
    await page.fill('input[name="itemRef"]', "DGS10");
    await page.fill('input[name="label"]', "US 10Y Treasury Yield");
    await page.click('button[type="submit"]');
    await page.waitForSelector("text=US 10Y Treasury Yield", { timeout: 10000 });
    body = await page.textContent("body");
    check("added item appears in the list", (body ?? "").includes("US 10Y Treasury Yield"));
    check("added item shows its type and ref", (body ?? "").includes("INDICATOR · DGS10"));
    check("tracked count reflects the new item", (body ?? "").includes("Tracked items (1)"));

    // An INDICATOR ref is not a company, so it must NOT be rendered as a company link — a dead
    // link would imply coverage the system does not have.
    check(
      "a non-company watchlist entry is not linked to a company page",
      (await page.locator('a[href^="/company/"]').count()) === 0,
    );

    await page.getByRole("button", { name: "Remove" }).click();
    await page.waitForSelector("text=Nothing tracked yet", { timeout: 10000 });
    body = await page.textContent("body");
    check("removed item is gone", !(body ?? "").includes("US 10Y Treasury Yield"));

    console.log("[6] Company X-Ray renders reported figures without any judgment");
    await page.goto(`${BASE_URL}/company`);
    body = await page.textContent("body");
    check("company index renders", (body ?? "").includes("Companies"));

    const companyLink = page.locator('a[href^="/company/"]').first();
    if ((await companyLink.count()) > 0) {
      await companyLink.click();
      await page.waitForURL("**/company/**", { timeout: 10000 });
      body = await page.textContent("body");
      check(
        "company page shows reported figures",
        (body ?? "").includes("Latest reported figures"),
      );
      check(
        "company page states it does not score or rate",
        (body ?? "").includes("does not score, rate or value companies"),
      );
      // The legal guardrail, checked structurally rather than trusted: no scoring or
      // recommendation language may appear on a company page.
      const lowered = (body ?? "").toLowerCase();
      check(
        "company page contains no rating or recommendation language",
        !/\b(strong buy|strong sell|overweight|underweight|price target|our rating|score:)\b/.test(
          lowered,
        ),
      );
    } else {
      // No ingested company in this database — the page must say so rather than render a shell
      // implying coverage it does not have.
      check("empty company index explains itself", (body ?? "").includes("No filings ingested"));
    }

    console.log("[7] Ask Market refuses a buy/sell question through the real request path");
    // The single highest legal-risk surface in the product (docs/LEGAL_GUARDRAILS.md). The
    // detector is unit-tested, but until now nothing proved it was actually wired into the page
    // a user reaches — a guardrail that exists only in a domain function protects nobody.
    // The canonical example from the legal docs, plus an English equivalent.
    for (const query of ["삼성전자 지금 살까?", "Should I buy Apple stock now?"]) {
      await page.goto(`${BASE_URL}/ask?q=${encodeURIComponent(query)}`);
      body = await page.textContent("body");
      check(
        `"${query}" is redirected, not answered`,
        (body ?? "").includes("doesn't give personalized buy/sell recommendations"),
      );
      // The redirect must not be accompanied by an actual recommendation anywhere on the page.
      const lowered = (body ?? "").toLowerCase();
      check(
        `"${query}" response contains no buy/sell verdict`,
        !/\b(you should buy|you should sell|we recommend buying|strong buy|price target)\b/.test(
          lowered,
        ),
      );
    }

    console.log("[8] Ask Market answers a factual topic query normally");
    await page.goto(`${BASE_URL}/ask?q=${encodeURIComponent("inflation")}`);
    body = await page.textContent("body");
    check(
      "a neutral factual query is not caught by the guardrail",
      !(body ?? "").includes("doesn't give personalized buy/sell recommendations"),
    );

    console.log("[9] Log out (logout control lives on /today)");
    await page.goto(`${BASE_URL}/today`);
    await page.getByRole("button", { name: /log ?out/i }).click();
    await page.waitForURL("**/login", { timeout: 10000 });
    check("redirected to /login after logout", page.url() === `${BASE_URL}/login`);

    console.log("[10] Wrong password is rejected without revealing which part was wrong");
    await page.fill('input[name="email"]', TEST_EMAIL);
    await page.fill('input[name="password"]', "totally-wrong-password");
    await page.click('button[type="submit"]');
    await page.waitForSelector("text=Invalid email or password", { timeout: 10000 });
    check("wrong password rejected", page.url() === `${BASE_URL}/login`);

    console.log("[11] Login lockout after 5 total failed attempts (1 already made above)");
    for (let i = 0; i < 4; i += 1) {
      await page.fill('input[name="email"]', TEST_EMAIL);
      await page.fill('input[name="password"]', "totally-wrong-password");
      await page.click('button[type="submit"]');
      await page.waitForSelector("text=Invalid email or password", { timeout: 10000 });
    }
    await page.fill('input[name="email"]', TEST_EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForSelector("text=Invalid email or password", { timeout: 10000 });
    check("locked out even with correct password", page.url() === `${BASE_URL}/login`);

    console.log("[12] Expired session redirects to /login instead of showing stale auth state");
    const user = await prisma.user.findUniqueOrThrow({ where: { email: TEST_EMAIL } });
    const expiredSession = await prisma.session.create({
      data: {
        id: "e2e-expired-session-token-".padEnd(64, "0"),
        userId: user.id,
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    await page.context().addCookies([
      {
        name: "market_os_session",
        value: expiredSession.id,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto(`${BASE_URL}/admin`);
    await page.waitForURL("**/login", { timeout: 10000 });
    check("expired session redirected to /login", page.url() === `${BASE_URL}/login`);
  } finally {
    await browser.close();
    await cleanupTestUser();
    await prisma.$disconnect();
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
