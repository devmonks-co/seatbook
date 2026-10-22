-- New enum values must be committed before they can be used (e.g. in the
-- partial index in the next migration), so they live in their own migration.
ALTER TYPE "BookingStatus" ADD VALUE 'HELD' BEFORE 'CONFIRMED';
ALTER TYPE "BookingStatus" ADD VALUE 'RELEASED';
ALTER TYPE "BookingStatus" ADD VALUE 'EXPIRED';
