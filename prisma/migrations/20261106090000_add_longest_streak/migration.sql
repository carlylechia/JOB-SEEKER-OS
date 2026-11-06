-- Track the all-time streak record separately from the live streak.
--
-- `streakCount` is reset when a day is missed, so it cannot answer "what is
-- this user's longest run?". Existing rows are backfilled from their current
-- streak, which is the best information available at migration time.
ALTER TABLE "User"
  ADD COLUMN "longestStreak" INTEGER NOT NULL DEFAULT 0;

UPDATE "User"
SET "longestStreak" = "streakCount"
WHERE "streakCount" > "longestStreak";
