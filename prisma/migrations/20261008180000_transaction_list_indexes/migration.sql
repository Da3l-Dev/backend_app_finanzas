CREATE INDEX IF NOT EXISTS "Transaction_userId_type_occurredAt_idx" ON "Transaction"("userId", "type", "occurredAt");
CREATE INDEX IF NOT EXISTS "Transaction_userId_createdAt_idx" ON "Transaction"("userId", "createdAt");
