CREATE TABLE "X402Settlement" (
    "id" TEXT NOT NULL,
    "receiptHash" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "routeId" TEXT,
    "routePath" TEXT NOT NULL,
    "routeMethod" TEXT NOT NULL,
    "priceUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "payer" TEXT,
    "transactionHash" TEXT NOT NULL,
    "network" TEXT,
    "decisionFrameId" TEXT,
    "proofHash" TEXT,
    "organizationId" TEXT,
    "projectId" TEXT,
    "creditQuantity" DOUBLE PRECISION NOT NULL,
    "creditUnit" TEXT NOT NULL,
    "creditRecorded" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "X402Settlement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "X402Settlement_receiptHash_key" ON "X402Settlement"("receiptHash");
CREATE INDEX "X402Settlement_transactionHash_idx" ON "X402Settlement"("transactionHash");
CREATE INDEX "X402Settlement_organizationId_createdAt_idx" ON "X402Settlement"("organizationId", "createdAt");
CREATE INDEX "X402Settlement_routePath_createdAt_idx" ON "X402Settlement"("routePath", "createdAt");

ALTER TABLE "X402Settlement" ADD CONSTRAINT "X402Settlement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "X402Settlement" ADD CONSTRAINT "X402Settlement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "X402PaymentEvent" ADD COLUMN "settlementId" TEXT;

CREATE INDEX "X402PaymentEvent_settlementId_idx" ON "X402PaymentEvent"("settlementId");

ALTER TABLE "X402PaymentEvent" ADD CONSTRAINT "X402PaymentEvent_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "X402Settlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
