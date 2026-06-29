-- Wardrobe capacity entitlement V1.
-- Keep historical migrations immutable; this migration updates the default
-- and self-heals legacy free-user compatibility fields.

ALTER TABLE users
ALTER COLUMN capacity_total SET DEFAULT 200;

UPDATE users
SET capacity_total = 200,
    updated_at = NOW()
WHERE COALESCE(membership_tier, 'free') = 'free'
  AND (capacity_total IS NULL OR capacity_total = 50);
