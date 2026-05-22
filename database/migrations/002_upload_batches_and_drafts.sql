-- ============================================================
-- Batch upload and multi-item recognition support.
-- Compatible with existing clothes rows: new clothes columns are nullable.
-- ============================================================

ALTER TABLE clothes
  ADD COLUMN IF NOT EXISTS batch_id UUID,
  ADD COLUMN IF NOT EXISTS source_image_id UUID,
  ADD COLUMN IF NOT EXISTS crop_box JSONB,
  ADD COLUMN IF NOT EXISTS confidence INT;

CREATE INDEX IF NOT EXISTS idx_clothes_batch_id ON clothes(batch_id);
CREATE INDEX IF NOT EXISTS idx_clothes_source_image_id ON clothes(source_image_id);

CREATE TABLE IF NOT EXISTS upload_batches (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  total_images          INT NOT NULL,
  processed_images      INT NOT NULL DEFAULT 0,
  total_detected_clothes INT NOT NULL DEFAULT 0,
  status                VARCHAR(24) NOT NULL DEFAULT 'pending',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_upload_batches_user_id ON upload_batches(user_id);
CREATE INDEX IF NOT EXISTS idx_upload_batches_status ON upload_batches(user_id, status);

CREATE TABLE IF NOT EXISTS upload_images (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id           UUID NOT NULL REFERENCES upload_batches(id) ON DELETE CASCADE,
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_image_url VARCHAR(512) NOT NULL,
  cloud_file_id      VARCHAR(512),
  status             VARCHAR(24) NOT NULL DEFAULT 'pending',
  detected_count     INT NOT NULL DEFAULT 0,
  error_message      TEXT,
  ai_raw_result      JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_upload_images_batch_id ON upload_images(batch_id);
CREATE INDEX IF NOT EXISTS idx_upload_images_user_id ON upload_images(user_id);
CREATE INDEX IF NOT EXISTS idx_upload_images_status ON upload_images(batch_id, status);

CREATE TABLE IF NOT EXISTS clothes_drafts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  batch_id           UUID NOT NULL REFERENCES upload_batches(id) ON DELETE CASCADE,
  source_image_id    UUID NOT NULL REFERENCES upload_images(id) ON DELETE CASCADE,
  original_image_url VARCHAR(512) NOT NULL,
  cropped_image_url  VARCHAR(512) NOT NULL,
  crop_box           JSONB,
  type               VARCHAR(32) NOT NULL,
  category_name      VARCHAR(64),
  color              VARCHAR(64),
  material           VARCHAR(64),
  style              VARCHAR(64),
  confidence         INT,
  selected           BOOLEAN NOT NULL DEFAULT true,
  status             VARCHAR(24) NOT NULL DEFAULT 'pending',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clothes_drafts_batch_id ON clothes_drafts(batch_id);
CREATE INDEX IF NOT EXISTS idx_clothes_drafts_user_id ON clothes_drafts(user_id);
CREATE INDEX IF NOT EXISTS idx_clothes_drafts_status ON clothes_drafts(batch_id, status);
