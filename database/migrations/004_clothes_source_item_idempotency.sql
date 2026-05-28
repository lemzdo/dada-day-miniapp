-- Idempotency for saving confirmed clothes drafts into wardrobe items.

ALTER TABLE clothes
  ADD COLUMN IF NOT EXISTS source_batch_id UUID,
  ADD COLUMN IF NOT EXISTS source_item_id UUID;

UPDATE clothes
SET source_batch_id = batch_id
WHERE source_batch_id IS NULL
  AND batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clothes_source_item_id ON clothes(source_item_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_clothes_source_item_unique
  ON clothes(user_id, source_batch_id, source_item_id)
  WHERE source_batch_id IS NOT NULL
    AND source_item_id IS NOT NULL;
