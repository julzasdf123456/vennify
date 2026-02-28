-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "customFields" JSONB,
ADD COLUMN     "relatedItemIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
