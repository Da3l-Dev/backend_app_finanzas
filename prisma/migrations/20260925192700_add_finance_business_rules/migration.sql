/*
  Warnings:

  - A unique constraint covering the columns `[userId,name,type]` on the table `Category` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[userId,code]` on the table `Category` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[userId,origin,externalReference]` on the table `Transaction` will be added. If there are existing duplicate values, this will fail.
  - Made the column `userId` on table `Category` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "TransactionOrigin" AS ENUM ('MOBILE', 'TELEGRAM', 'RECURRING', 'SYSTEM');

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Budget" ALTER COLUMN "month" SET DATA TYPE DATE;

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "code" TEXT,
ALTER COLUMN "userId" SET NOT NULL;

-- AlterTable
ALTER TABLE "RecurringTransaction" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'MXN';

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "externalReference" TEXT,
ADD COLUMN     "origin" "TransactionOrigin" NOT NULL DEFAULT 'MOBILE',
ALTER COLUMN "status" SET DEFAULT 'PENDING',
ALTER COLUMN "occurredAt" SET DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE UNIQUE INDEX "Category_userId_name_type_key" ON "Category"("userId", "name", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Category_userId_code_key" ON "Category"("userId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_userId_origin_externalReference_key" ON "Transaction"("userId", "origin", "externalReference");
