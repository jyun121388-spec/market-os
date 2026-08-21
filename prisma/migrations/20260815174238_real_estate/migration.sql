-- CreateEnum
CREATE TYPE "RealEstateDealType" AS ENUM ('SALE', 'JEONSE', 'WOLSE');

-- CreateTable
CREATE TABLE "real_estate_transactions" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "propertyType" TEXT NOT NULL,
    "dealType" "RealEstateDealType" NOT NULL,
    "areaSqm" DECIMAL(8,2) NOT NULL,
    "price" DECIMAL(16,2) NOT NULL,
    "dealDate" TIMESTAMP(3) NOT NULL,
    "buildYear" INTEGER,
    "floor" INTEGER,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "real_estate_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "real_estate_transactions_sourceId_region_dealType_dealDate_idx" ON "real_estate_transactions"("sourceId", "region", "dealType", "dealDate");

-- AddForeignKey
ALTER TABLE "real_estate_transactions" ADD CONSTRAINT "real_estate_transactions_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
