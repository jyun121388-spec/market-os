-- CreateEnum
CREATE TYPE "CausalDirection" AS ENUM ('POSITIVE', 'NEGATIVE', 'AMBIGUOUS');

-- CreateEnum
CREATE TYPE "CausalConfidence" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateTable
CREATE TABLE "causal_edges" (
    "id" TEXT NOT NULL,
    "fromVariable" TEXT NOT NULL,
    "toVariable" TEXT NOT NULL,
    "direction" "CausalDirection" NOT NULL,
    "confidence" "CausalConfidence" NOT NULL,
    "mechanism" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "lag" TEXT NOT NULL,
    "conditions" TEXT,
    "counterexamples" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "causal_edges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "causal_edges_fromVariable_idx" ON "causal_edges"("fromVariable");

-- CreateIndex
CREATE INDEX "causal_edges_toVariable_idx" ON "causal_edges"("toVariable");
