-- ============================================================
-- 搭一搭 · 初始数据库迁移
-- 版本: v0.1
-- 说明: Phase 0 一次性建完所有表，后续只增不改结构
-- ============================================================

-- 启用 UUID 扩展
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ====================
-- 用户表
-- ====================
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wechat_openid   VARCHAR(128) UNIQUE NOT NULL,
    unionid         VARCHAR(128),
    nickname        VARCHAR(64),
    avatar_url      VARCHAR(512),
    style_profile   JSONB DEFAULT '{}',
    capacity_total  INT DEFAULT 50,
    capacity_used   INT DEFAULT 0,
    membership_tier VARCHAR(16) DEFAULT 'free',
    reminder_time   TIME,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ====================
-- 衣服表
-- ====================
CREATE TABLE IF NOT EXISTS clothes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    image_url       VARCHAR(512) NOT NULL,
    thumbnail_url   VARCHAR(512),

    -- AI 识别结果
    category        VARCHAR(32) NOT NULL,
    subcategory     VARCHAR(64),
    color_palette   JSONB,
    style_tags      JSONB DEFAULT '[]',
    season_tags     JSONB DEFAULT '[]',
    material        VARCHAR(64),
    scene_tags      JSONB DEFAULT '[]',
    ai_raw_result   JSONB,

    -- 用户自定义
    custom_name     VARCHAR(64),
    custom_category VARCHAR(32),
    custom_tags     JSONB DEFAULT '[]',

    capacity_cost   INT DEFAULT 1,
    status          VARCHAR(16) DEFAULT 'active',
    brand           VARCHAR(64),
    purchase_date   DATE,

    -- 统计
    usage_count     INT DEFAULT 0,
    last_worn_at    TIMESTAMPTZ,

    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clothes_user_id ON clothes(user_id);
CREATE INDEX IF NOT EXISTS idx_clothes_category ON clothes(user_id, category);
CREATE INDEX IF NOT EXISTS idx_clothes_status ON clothes(user_id, status);

-- ====================
-- 穿搭方案表
-- ====================
CREATE TABLE IF NOT EXISTS outfits (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title           VARCHAR(128),

    clothing_ids    UUID[] NOT NULL,
    scene           VARCHAR(32),
    target_date     DATE,
    time_of_day     VARCHAR(16),

    -- 天气快照
    weather_snapshot JSONB,

    -- AI 评分
    scores          JSONB,
    score_explanations JSONB DEFAULT '[]',

    -- 生成信息
    generation_type VARCHAR(16) DEFAULT 'auto',
    source_item_id  UUID,

    is_favorite     BOOLEAN DEFAULT false,
    is_worn_today   BOOLEAN DEFAULT false,

    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outfits_user_id ON outfits(user_id);
CREATE INDEX IF NOT EXISTS idx_outfits_target_date ON outfits(user_id, target_date);

-- ====================
-- 穿搭历史表
-- ====================
CREATE TABLE IF NOT EXISTS outfit_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    outfit_id       UUID REFERENCES outfits(id) ON DELETE SET NULL,
    clothing_ids    UUID[] NOT NULL,
    wear_date       DATE NOT NULL,
    time_of_day     VARCHAR(16),
    scene           VARCHAR(32),
    weather_snapshot JSONB,

    satisfaction    INT CHECK (satisfaction BETWEEN 1 AND 5),
    notes           VARCHAR(512),

    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_history_user_date ON outfit_history(user_id, wear_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_history_user_date_tod ON outfit_history(user_id, wear_date, time_of_day);

-- ====================
-- 分享记录表
-- ====================
CREATE TABLE IF NOT EXISTS share_records (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    outfit_id       UUID NOT NULL REFERENCES outfits(id) ON DELETE CASCADE,
    share_type      VARCHAR(16) NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- ====================
-- 提醒设置表
-- ====================
CREATE TABLE IF NOT EXISTS reminders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    enabled         BOOLEAN DEFAULT false,
    push_time       TIME DEFAULT '08:00',
    days_of_week    INT[] DEFAULT '{1,2,3,4,5}',
    rain_alert      BOOLEAN DEFAULT true,
    temp_drop_alert BOOLEAN DEFAULT true,

    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ====================
-- 衣柜分析报告表
-- ====================
CREATE TABLE IF NOT EXISTS wardrobe_analyses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    analysis_date   DATE NOT NULL DEFAULT CURRENT_DATE,

    style_breakdown JSONB,
    color_breakdown JSONB,
    category_counts JSONB,
    top_used        UUID[],
    unused_items    UUID[],
    missing_suggestions JSONB DEFAULT '[]',
    overall_score   INT,

    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analysis_user_date ON wardrobe_analyses(user_id, analysis_date DESC);

-- ====================
-- 天气缓存表
-- ====================
CREATE TABLE IF NOT EXISTS weather_cache (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    location_key    VARCHAR(128) NOT NULL,
    target_date     DATE NOT NULL,
    weather_data    JSONB NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT now(),

    UNIQUE(location_key, target_date)
);
