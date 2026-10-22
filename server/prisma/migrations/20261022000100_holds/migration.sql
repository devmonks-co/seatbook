-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "expiresAt" TIMESTAMP(3),
ADD COLUMN "confirmedAt" TIMESTAMP(3),
ADD COLUMN "releasedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Booking_userId_status_idx" ON "Booking"("userId", "status");

-- CreateIndex
CREATE INDEX "Booking_seatId_status_idx" ON "Booking"("seatId", "status");

-- A hold must say when it ends.
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_hold_has_expiry"
  CHECK ("status" <> 'HELD' OR "expiresAt" IS NOT NULL);

-- The real guarantee against double booking: a seat can have at most one live
-- (HELD or CONFIRMED) booking. The old check-then-insert in application code
-- let concurrent requests book the same seat several times.
--
-- If this fails on existing data, those seats are already double booked. Find
-- them with:
--   SELECT "seatId", array_agg(id) FROM "Booking"
--   WHERE status = 'CONFIRMED' GROUP BY "seatId" HAVING count(*) > 1;
-- and decide with the organizer which booking to keep. The migration runs in a
-- transaction, so nothing is half applied; after fixing the data run
--   npx prisma migrate resolve --rolled-back 20261022000100_holds
-- and deploy again.
CREATE UNIQUE INDEX "Booking_seat_active_key" ON "Booking"("seatId")
  WHERE "status" IN ('HELD', 'CONFIRMED');
