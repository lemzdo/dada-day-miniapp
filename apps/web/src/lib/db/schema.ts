// ============================================================
// 搭一搭 · Drizzle Schema 定义
// 与 database/migrations/001_initial_schema.sql 保持一致
// ============================================================

import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  integer,
  boolean,
  text,
  date,
  time,
  timestamp,
  uniqueIndex,
  index,
  customType,
} from 'drizzle-orm/pg-core';

// ── 自定义类型：PostgreSQL 数组 → JSON 序列化 ──

const uuidArray = customType<{ data: string[]; driver: string }>({
  dataType() {
    return 'uuid[]';
  },
});

const textArray = customType<{ data: string[]; driver: string }>({
  dataType() {
    return 'text[]';
  },
});

const intArray = customType<{ data: number[]; driver: string }>({
  dataType() {
    return 'integer[]';
  },
});

// ── 用户表 ──

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  wechatOpenid: varchar('wechat_openid', { length: 128 }).notNull().unique(),
  unionid: varchar('unionid', { length: 128 }),
  nickname: varchar('nickname', { length: 64 }),
  avatarUrl: varchar('avatar_url', { length: 512 }),
  styleProfile: jsonb('style_profile').default({}).$type<Record<string, unknown>>(),
  capacityTotal: integer('capacity_total').default(50),
  capacityUsed: integer('capacity_used').default(0),
  membershipTier: varchar('membership_tier', { length: 16 }).default('free'),
  reminderTime: time('reminder_time'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ── 衣服表 ──

export const clothes = pgTable(
  'clothes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    imageUrl: varchar('image_url', { length: 512 }).notNull(),
    thumbnailUrl: varchar('thumbnail_url', { length: 512 }),
    assetVersion: varchar('asset_version', { length: 16 }),
    originalImageUrl: varchar('original_image_url', { length: 512 }),
    normalizedImageUrl: varchar('normalized_image_url', { length: 512 }),
    cropImageUrl: varchar('crop_image_url', { length: 512 }),
    croppedImageUrl: varchar('cropped_image_url', { length: 512 }),
    maskImageUrl: varchar('mask_image_url', { length: 512 }),
    cleanImageUrl: varchar('clean_image_url', { length: 512 }),
    displayImageUrl: varchar('display_image_url', { length: 512 }),
    imageSourceType: varchar('image_source_type', { length: 24 }),
    assetStatus: varchar('asset_status', { length: 24 }),
    qualityScore: integer('quality_score'),
    needsUserConfirm: boolean('needs_user_confirm'),
    confirmReasons: jsonb('confirm_reasons').default([]).$type<string[]>(),
    bbox: jsonb('bbox').$type<{ x: number; y: number; width: number; height: number }>(),
    itemIndex: integer('item_index'),
    stageStatus: jsonb('stage_status').$type<Record<string, string>>(),
    providerTrace: jsonb('provider_trace').default([]).$type<unknown[]>(),
    aiSegmentImageUrl: varchar('ai_segment_image_url', { length: 512 }),
    manualCropImageUrl: varchar('manual_crop_image_url', { length: 512 }),
    detectStatus: varchar('detect_status', { length: 24 }),
    segmentStatus: varchar('segment_status', { length: 24 }),
    manualCropStatus: varchar('manual_crop_status', { length: 24 }),
    batchId: uuid('batch_id'),
    sourceBatchId: uuid('source_batch_id'),
    sourceItemId: uuid('source_item_id'),
    sourceImageId: uuid('source_image_id'),
    cropBox: jsonb('crop_box').$type<{ x: number; y: number; width: number; height: number }>(),
    confidence: integer('confidence'),

    // AI 识别结果
    category: varchar('category', { length: 32 }).notNull(),
    type: varchar('type', { length: 32 }),
    categoryName: varchar('category_name', { length: 64 }),
    subcategory: varchar('subcategory', { length: 64 }),
    color: varchar('color', { length: 64 }),
    colorPalette: jsonb('color_palette').$type<Array<{ name: string; hex: string; ratio: number }>>(),
    styleTags: jsonb('style_tags').default([]).$type<string[]>(),
    seasonTags: jsonb('season_tags').default([]).$type<string[]>(),
    material: varchar('material', { length: 64 }),
    sceneTags: jsonb('scene_tags').default([]).$type<string[]>(),
    aiRawResult: jsonb('ai_raw_result'),

    // 用户自定义
    customName: varchar('custom_name', { length: 64 }),
    customCategory: varchar('custom_category', { length: 32 }),
    customTags: jsonb('custom_tags').default([]).$type<string[]>(),

    capacityCost: integer('capacity_cost').default(1),
    status: varchar('status', { length: 16 }).default('active'),
    brand: varchar('brand', { length: 64 }),
    purchaseDate: date('purchase_date'),

    // 统计
    usageCount: integer('usage_count').default(0),
    lastWornAt: timestamp('last_worn_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_clothes_user_id').on(table.userId),
    index('idx_clothes_category').on(table.userId, table.category),
    index('idx_clothes_status').on(table.userId, table.status),
    index('idx_clothes_batch_id').on(table.batchId),
    index('idx_clothes_source_image_id').on(table.sourceImageId),
    uniqueIndex('idx_clothes_source_item_unique').on(table.userId, table.sourceBatchId, table.sourceItemId),
  ],
);

// ── 穿搭方案表 ──

export const uploadBatches = pgTable(
  'upload_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    totalImages: integer('total_images').notNull(),
    processedImages: integer('processed_images').default(0).notNull(),
    totalDetectedClothes: integer('total_detected_clothes').default(0).notNull(),
    status: varchar('status', { length: 24 }).default('pending').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_upload_batches_user_id').on(table.userId),
    index('idx_upload_batches_status').on(table.userId, table.status),
  ],
);

export const uploadImages = pgTable(
  'upload_images',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id').notNull().references(() => uploadBatches.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    originalImageUrl: varchar('original_image_url', { length: 512 }).notNull(),
    cloudFileId: varchar('cloud_file_id', { length: 512 }),
    assetVersion: varchar('asset_version', { length: 16 }),
    normalizedImageUrl: varchar('normalized_image_url', { length: 512 }),
    routerResult: jsonb('router_result'),
    detectStatus: varchar('detect_status', { length: 24 }),
    segmentStatus: varchar('segment_status', { length: 24 }),
    status: varchar('status', { length: 24 }).default('pending').notNull(),
    detectedCount: integer('detected_count').default(0).notNull(),
    errorMessage: text('error_message'),
    aiRawResult: jsonb('ai_raw_result'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_upload_images_batch_id').on(table.batchId),
    index('idx_upload_images_user_id').on(table.userId),
    index('idx_upload_images_status').on(table.batchId, table.status),
  ],
);

export const clothesDrafts = pgTable(
  'clothes_drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    batchId: uuid('batch_id').notNull().references(() => uploadBatches.id, { onDelete: 'cascade' }),
    sourceImageId: uuid('source_image_id').notNull().references(() => uploadImages.id, { onDelete: 'cascade' }),
    assetVersion: varchar('asset_version', { length: 16 }),
    originalImageUrl: varchar('original_image_url', { length: 512 }).notNull(),
    normalizedImageUrl: varchar('normalized_image_url', { length: 512 }),
    cropImageUrl: varchar('crop_image_url', { length: 512 }),
    croppedImageUrl: varchar('cropped_image_url', { length: 512 }).notNull(),
    maskImageUrl: varchar('mask_image_url', { length: 512 }),
    cleanImageUrl: varchar('clean_image_url', { length: 512 }),
    displayImageUrl: varchar('display_image_url', { length: 512 }),
    imageUrl: varchar('image_url', { length: 512 }),
    imageSourceType: varchar('image_source_type', { length: 24 }),
    assetStatus: varchar('asset_status', { length: 24 }),
    qualityScore: integer('quality_score'),
    needsUserConfirm: boolean('needs_user_confirm'),
    confirmReasons: jsonb('confirm_reasons').default([]).$type<string[]>(),
    bbox: jsonb('bbox').$type<{ x: number; y: number; width: number; height: number }>(),
    itemIndex: integer('item_index'),
    stageStatus: jsonb('stage_status').$type<Record<string, string>>(),
    providerTrace: jsonb('provider_trace').default([]).$type<unknown[]>(),
    aiSegmentImageUrl: varchar('ai_segment_image_url', { length: 512 }),
    manualCropImageUrl: varchar('manual_crop_image_url', { length: 512 }),
    detectStatus: varchar('detect_status', { length: 24 }),
    segmentStatus: varchar('segment_status', { length: 24 }),
    manualCropStatus: varchar('manual_crop_status', { length: 24 }),
    cropBox: jsonb('crop_box').$type<{ x: number; y: number; width: number; height: number }>(),
    type: varchar('type', { length: 32 }).notNull(),
    categoryName: varchar('category_name', { length: 64 }),
    color: varchar('color', { length: 64 }),
    colors: jsonb('colors').default([]).$type<string[]>(),
    material: varchar('material', { length: 64 }),
    style: varchar('style', { length: 64 }),
    styleTags: jsonb('style_tags').default([]).$type<string[]>(),
    seasonTags: jsonb('season_tags').default([]).$type<string[]>(),
    confidence: integer('confidence'),
    selected: boolean('selected').default(true).notNull(),
    status: varchar('status', { length: 24 }).default('pending').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_clothes_drafts_batch_id').on(table.batchId),
    index('idx_clothes_drafts_user_id').on(table.userId),
    index('idx_clothes_drafts_status').on(table.batchId, table.status),
  ],
);

export const outfits = pgTable(
  'outfits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 128 }),
    clothingIds: uuidArray('clothing_ids').notNull(),
    scene: varchar('scene', { length: 32 }),
    targetDate: date('target_date'),
    timeOfDay: varchar('time_of_day', { length: 16 }),
    weatherSnapshot: jsonb('weather_snapshot').$type<Record<string, unknown>>(),
    scores: jsonb('scores').$type<Record<string, number>>(),
    scoreExplanations: jsonb('score_explanations').default([]).$type<unknown[]>(),
    generationType: varchar('generation_type', { length: 16 }).default('auto'),
    sourceItemId: uuid('source_item_id'),
    isFavorite: boolean('is_favorite').default(false),
    isWornToday: boolean('is_worn_today').default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_outfits_user_id').on(table.userId),
    index('idx_outfits_target_date').on(table.userId, table.targetDate),
  ],
);

// ── 穿搭历史表 ──

export const outfitHistory = pgTable(
  'outfit_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    outfitId: uuid('outfit_id').references(() => outfits.id, { onDelete: 'set null' }),
    clothingIds: uuidArray('clothing_ids').notNull(),
    wearDate: date('wear_date').notNull(),
    timeOfDay: varchar('time_of_day', { length: 16 }),
    scene: varchar('scene', { length: 32 }),
    weatherSnapshot: jsonb('weather_snapshot').$type<Record<string, unknown>>(),
    satisfaction: integer('satisfaction'),
    notes: varchar('notes', { length: 512 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_history_user_date').on(table.userId, table.wearDate),
    uniqueIndex('idx_history_user_date_tod').on(table.userId, table.wearDate, table.timeOfDay),
  ],
);

// ── 分享记录表 ──

export const shareRecords = pgTable('share_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  outfitId: uuid('outfit_id').notNull().references(() => outfits.id, { onDelete: 'cascade' }),
  shareType: varchar('share_type', { length: 16 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ── 提醒设置表 ──

export const reminders = pgTable('reminders', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  enabled: boolean('enabled').default(false),
  pushTime: time('push_time').default('08:00'),
  daysOfWeek: intArray('days_of_week').default([1, 2, 3, 4, 5]),
  rainAlert: boolean('rain_alert').default(true),
  tempDropAlert: boolean('temp_drop_alert').default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ── 衣柜分析报告表 ──

export const wardrobeAnalyses = pgTable(
  'wardrobe_analyses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    analysisDate: date('analysis_date').defaultNow().notNull(),
    styleBreakdown: jsonb('style_breakdown').$type<Record<string, number>>(),
    colorBreakdown: jsonb('color_breakdown').$type<Record<string, number>>(),
    categoryCounts: jsonb('category_counts').$type<Record<string, number>>(),
    topUsed: uuidArray('top_used'),
    unusedItems: uuidArray('unused_items'),
    missingSuggestions: jsonb('missing_suggestions').default([]).$type<unknown[]>(),
    overallScore: integer('overall_score'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_analysis_user_date').on(table.userId, table.analysisDate),
  ],
);

// ── 天气缓存表 ──

export const weatherCache = pgTable(
  'weather_cache',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationKey: varchar('location_key', { length: 128 }).notNull(),
    targetDate: date('target_date').notNull(),
    weatherData: jsonb('weather_data').notNull().$type<unknown>(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('weather_cache_location_date').on(table.locationKey, table.targetDate),
  ],
);
