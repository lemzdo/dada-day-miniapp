-- ============================================================
-- Wardrobe asset pipeline v2 fields.
-- Nullable for compatibility with existing v1 clothes and drafts.
-- ============================================================

ALTER TABLE upload_images
  ADD COLUMN IF NOT EXISTS asset_version VARCHAR(16),
  ADD COLUMN IF NOT EXISTS normalized_image_url VARCHAR(512),
  ADD COLUMN IF NOT EXISTS router_result JSONB,
  ADD COLUMN IF NOT EXISTS detect_status VARCHAR(24),
  ADD COLUMN IF NOT EXISTS segment_status VARCHAR(24);

ALTER TABLE clothes_drafts
  ADD COLUMN IF NOT EXISTS asset_version VARCHAR(16),
  ADD COLUMN IF NOT EXISTS normalized_image_url VARCHAR(512),
  ADD COLUMN IF NOT EXISTS crop_image_url VARCHAR(512),
  ADD COLUMN IF NOT EXISTS mask_image_url VARCHAR(512),
  ADD COLUMN IF NOT EXISTS clean_image_url VARCHAR(512),
  ADD COLUMN IF NOT EXISTS display_image_url VARCHAR(512),
  ADD COLUMN IF NOT EXISTS image_url VARCHAR(512),
  ADD COLUMN IF NOT EXISTS image_source_type VARCHAR(24),
  ADD COLUMN IF NOT EXISTS asset_status VARCHAR(24),
  ADD COLUMN IF NOT EXISTS quality_score INT,
  ADD COLUMN IF NOT EXISTS needs_user_confirm BOOLEAN,
  ADD COLUMN IF NOT EXISTS confirm_reasons JSONB,
  ADD COLUMN IF NOT EXISTS bbox JSONB,
  ADD COLUMN IF NOT EXISTS item_index INT,
  ADD COLUMN IF NOT EXISTS stage_status JSONB,
  ADD COLUMN IF NOT EXISTS provider_trace JSONB,
  ADD COLUMN IF NOT EXISTS ai_segment_image_url VARCHAR(512),
  ADD COLUMN IF NOT EXISTS manual_crop_image_url VARCHAR(512),
  ADD COLUMN IF NOT EXISTS detect_status VARCHAR(24),
  ADD COLUMN IF NOT EXISTS segment_status VARCHAR(24),
  ADD COLUMN IF NOT EXISTS manual_crop_status VARCHAR(24),
  ADD COLUMN IF NOT EXISTS colors JSONB,
  ADD COLUMN IF NOT EXISTS style_tags JSONB,
  ADD COLUMN IF NOT EXISTS season_tags JSONB;

ALTER TABLE clothes
  ADD COLUMN IF NOT EXISTS asset_version VARCHAR(16),
  ADD COLUMN IF NOT EXISTS original_image_url VARCHAR(512),
  ADD COLUMN IF NOT EXISTS normalized_image_url VARCHAR(512),
  ADD COLUMN IF NOT EXISTS crop_image_url VARCHAR(512),
  ADD COLUMN IF NOT EXISTS cropped_image_url VARCHAR(512),
  ADD COLUMN IF NOT EXISTS mask_image_url VARCHAR(512),
  ADD COLUMN IF NOT EXISTS clean_image_url VARCHAR(512),
  ADD COLUMN IF NOT EXISTS display_image_url VARCHAR(512),
  ADD COLUMN IF NOT EXISTS image_source_type VARCHAR(24),
  ADD COLUMN IF NOT EXISTS asset_status VARCHAR(24),
  ADD COLUMN IF NOT EXISTS quality_score INT,
  ADD COLUMN IF NOT EXISTS needs_user_confirm BOOLEAN,
  ADD COLUMN IF NOT EXISTS confirm_reasons JSONB,
  ADD COLUMN IF NOT EXISTS bbox JSONB,
  ADD COLUMN IF NOT EXISTS item_index INT,
  ADD COLUMN IF NOT EXISTS stage_status JSONB,
  ADD COLUMN IF NOT EXISTS provider_trace JSONB,
  ADD COLUMN IF NOT EXISTS ai_segment_image_url VARCHAR(512),
  ADD COLUMN IF NOT EXISTS manual_crop_image_url VARCHAR(512),
  ADD COLUMN IF NOT EXISTS detect_status VARCHAR(24),
  ADD COLUMN IF NOT EXISTS segment_status VARCHAR(24),
  ADD COLUMN IF NOT EXISTS manual_crop_status VARCHAR(24),
  ADD COLUMN IF NOT EXISTS category_name VARCHAR(64),
  ADD COLUMN IF NOT EXISTS type VARCHAR(32),
  ADD COLUMN IF NOT EXISTS color VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_clothes_asset_status ON clothes(user_id, asset_status);
CREATE INDEX IF NOT EXISTS idx_clothes_drafts_asset_status ON clothes_drafts(batch_id, asset_status);
