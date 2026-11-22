-- AlterEnum
ALTER TYPE "RampStatus" ADD VALUE 'PROCESSING';

-- AlterTable
ALTER TABLE "RampTransaction" ADD COLUMN     "deliveryError" TEXT,
ADD COLUMN     "deliveryTxHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "RampTransaction_deliveryTxHash_key" ON "RampTransaction"("deliveryTxHash");

