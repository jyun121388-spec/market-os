-- CreateTable
CREATE TABLE "financial_facts" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "corpCode" TEXT NOT NULL,
    "taxonomy" TEXT NOT NULL,
    "concept" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "fiscalPeriod" TEXT NOT NULL,
    "form" TEXT NOT NULL,
    "accessionNumber" TEXT NOT NULL,
    "filedDate" TIMESTAMP(3) NOT NULL,
    "value" DECIMAL(24,4) NOT NULL,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_facts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "financial_facts_sourceId_corpCode_concept_idx" ON "financial_facts"("sourceId", "corpCode", "concept");

-- CreateIndex
CREATE UNIQUE INDEX "financial_facts_sourceId_corpCode_concept_unit_periodEnd_ac_key" ON "financial_facts"("sourceId", "corpCode", "concept", "unit", "periodEnd", "accessionNumber");

-- AddForeignKey
ALTER TABLE "financial_facts" ADD CONSTRAINT "financial_facts_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
