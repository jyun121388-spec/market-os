import { prisma } from "@/server/db/client";
import type { Prisma } from "@/generated/prisma/client";

export type ObservationIngestStatus = "inserted" | "revised" | "unchanged";

export interface ObservationIngestInput {
  seriesId: string;
  sourceId: string;
  observationDate: Date;
  value: string;
  raw: Prisma.InputJsonValue;
}

/**
 * Shared revision-preserving observation upsert used by every source adapter's ingest
 * pipeline (FRED, ECOS, ...). A changed value for an already-stored observation date is
 * never silently overwritten: it is inserted as a new row with isRevision/revisionOf pointing
 * at the prior row (docs/DATA_POLICY.md financial-data checklist: "revised vs
 * preliminary/final"). An unchanged value is a no-op, keeping re-ingestion idempotent.
 */
export async function upsertRevisionAwareObservation(
  input: ObservationIngestInput,
): Promise<ObservationIngestStatus> {
  const existing = await prisma.observation.findFirst({
    where: { seriesId: input.seriesId, observationDate: input.observationDate },
    orderBy: { retrievedAt: "desc" },
  });

  if (!existing) {
    await prisma.observation.create({
      data: {
        seriesId: input.seriesId,
        sourceId: input.sourceId,
        observationDate: input.observationDate,
        value: input.value,
        raw: input.raw,
      },
    });
    return "inserted";
  }

  if (Number(existing.value.toString()) === Number(input.value)) {
    return "unchanged";
  }

  await prisma.observation.create({
    data: {
      seriesId: input.seriesId,
      sourceId: input.sourceId,
      observationDate: input.observationDate,
      value: input.value,
      isRevision: true,
      revisionOf: existing.id,
      raw: input.raw,
    },
  });
  return "revised";
}
