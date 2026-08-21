-- CreateEnum
CREATE TYPE "SourceTier" AS ENUM ('TIER_S', 'TIER_A', 'TIER_B', 'TIER_C', 'TIER_D');

-- CreateEnum
CREATE TYPE "ClaimType" AS ENUM ('FACT', 'CALCULATION', 'INFERENCE');

-- CreateTable
CREATE TABLE "sources" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tier" "SourceTier" NOT NULL,
    "homepage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "series" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "observations" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "observationDate" TIMESTAMP(3) NOT NULL,
    "releaseDate" TIMESTAMP(3),
    "value" DECIMAL(20,6) NOT NULL,
    "isPreliminary" BOOLEAN NOT NULL DEFAULT false,
    "isRevision" BOOLEAN NOT NULL DEFAULT false,
    "revisionOf" TEXT,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_conflicts" (
    "id" TEXT NOT NULL,
    "observationId" TEXT NOT NULL,
    "conflictingWith" JSONB NOT NULL,
    "officialSource" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claims" (
    "id" TEXT NOT NULL,
    "claimText" TEXT NOT NULL,
    "claimType" "ClaimType" NOT NULL,
    "sourceId" TEXT,
    "sourceUrl" TEXT,
    "sourceTimestamp" TIMESTAMP(3),
    "retrievedAt" TIMESTAMP(3),
    "evidence" JSONB,
    "confidence" DOUBLE PRECISION,
    "conflictStatus" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sources_code_key" ON "sources"("code");

-- CreateIndex
CREATE UNIQUE INDEX "series_sourceId_externalId_key" ON "series"("sourceId", "externalId");

-- CreateIndex
CREATE INDEX "observations_seriesId_observationDate_idx" ON "observations"("seriesId", "observationDate");

-- CreateIndex
CREATE UNIQUE INDEX "observations_seriesId_observationDate_isRevision_revisionOf_key" ON "observations"("seriesId", "observationDate", "isRevision", "revisionOf");

-- CreateIndex
CREATE INDEX "claims_claimType_idx" ON "claims"("claimType");

-- AddForeignKey
ALTER TABLE "series" ADD CONSTRAINT "series_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "series"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_conflicts" ADD CONSTRAINT "data_conflicts_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "observations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
