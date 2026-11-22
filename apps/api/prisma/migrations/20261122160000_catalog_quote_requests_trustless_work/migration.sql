-- CreateEnum
CREATE TYPE "EscrowEngine" AS ENUM ('MONTUNO', 'TRUSTLESS_WORK');

-- CreateEnum
CREATE TYPE "QuoteRequestStatus" AS ENUM ('OPEN', 'QUOTED', 'CLOSED');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "escrowEngine" "EscrowEngine" NOT NULL DEFAULT 'MONTUNO',
ADD COLUMN     "twContractId" TEXT;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "escrowEngine" "EscrowEngine" NOT NULL DEFAULT 'MONTUNO',
ADD COLUMN     "quoteRequestId" UUID;

-- CreateTable
CREATE TABLE "CatalogItem" (
    "id" UUID NOT NULL,
    "importerId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "referencePriceFiat" DECIMAL(20,2) NOT NULL,
    "fiatCurrency" TEXT NOT NULL,
    "referenceUrl" TEXT,
    "deliveryEstimateDays" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteRequest" (
    "id" UUID NOT NULL,
    "importerId" UUID NOT NULL,
    "buyerId" UUID NOT NULL,
    "catalogItemId" UUID,
    "productUrl" TEXT,
    "details" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "destinationCity" TEXT NOT NULL,
    "status" "QuoteRequestStatus" NOT NULL DEFAULT 'OPEN',
    "checkoutTokenEnc" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CatalogItem_active_category_idx" ON "CatalogItem"("active", "category");

-- CreateIndex
CREATE INDEX "CatalogItem_importerId_idx" ON "CatalogItem"("importerId");

-- CreateIndex
CREATE INDEX "QuoteRequest_importerId_status_idx" ON "QuoteRequest"("importerId", "status");

-- CreateIndex
CREATE INDEX "QuoteRequest_buyerId_idx" ON "QuoteRequest"("buyerId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_twContractId_key" ON "Order"("twContractId");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_quoteRequestId_key" ON "Quote"("quoteRequestId");

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "QuoteRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogItem" ADD CONSTRAINT "CatalogItem_importerId_fkey" FOREIGN KEY ("importerId") REFERENCES "Importer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteRequest" ADD CONSTRAINT "QuoteRequest_importerId_fkey" FOREIGN KEY ("importerId") REFERENCES "Importer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteRequest" ADD CONSTRAINT "QuoteRequest_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteRequest" ADD CONSTRAINT "QuoteRequest_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

