import { NextResponse } from "next/server";
import { prisma } from "@/server/db/client";
import { classifyReadiness } from "@/lib/readiness";

export const dynamic = "force-dynamic";

/**
 * `GET /api/ready` — the launcher's readiness gate.
 *
 * Two probes, in the order `classifyReadiness` requires, and every failure is swallowed into a
 * boolean here rather than travelling any further. That is the whole security design of this
 * route: an exception object never escapes these try/catch blocks, so there is no path by which a
 * connection string, a filesystem path or a stack frame could reach the response body.
 *
 * Not cached, and never 200 when NOT_READY — a launcher polling this must be able to distinguish
 * the two by status code alone if it wants to.
 */
export async function GET() {
  let databaseReachable = false;
  let schemaUsable = false;

  try {
    await prisma.$queryRaw`SELECT 1`;
    databaseReachable = true;
  } catch {
    databaseReachable = false;
  }

  if (databaseReachable) {
    try {
      // A product table, not `_prisma_migrations`: a recorded migration says the runner finished,
      // and this needs to know the schema is actually READABLE by the application's own client.
      await prisma.source.count();
      schemaUsable = true;
    } catch {
      schemaUsable = false;
    }
  }

  const result = classifyReadiness({ databaseReachable, schemaUsable });
  return NextResponse.json(result, {
    status: result.status === "READY" ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
