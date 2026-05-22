// ============================================================
// 穿搭推荐 API
// POST /api/v1/outfits/recommend - 生成穿搭推荐
// ============================================================

import { NextResponse } from 'next/server';
import { getUserIdFromRequest, isAuthError } from '@/lib/auth';
import {
  getClothesList,
  getRecentlyWornClothingIds,
  createOutfit,
  findReusableOutfit,
  getUserProfile,
} from '@/lib/db/repositories';
import { generateRecommendations, toWardrobeItem } from '@/lib/recommend/engine';
import { getWeatherSnapshotWithCache } from '@/lib/weather/service';
import { normalizeRecommendationProfile } from '@starter-template/utils';
import type { RecommendRequest, RecommendResponse, Outfit, OutfitItemSummary, WeatherSnapshot, OutfitScores } from '@starter-template/types';
import type { SceneTag, TimeOfDay, ClothingCategory } from '@starter-template/types';

// ── POST /api/v1/outfits/recommend ───────────────────────────

export async function POST(request: Request) {
  try {
    const userId = getUserIdFromRequest(request);
    const body = (await request.json().catch(() => ({}))) as RecommendRequest;

    // 1. 获取用户衣橱（全部衣服）
    const { list: clothes } = await getClothesList({
      userId,
      status: 'active',
      page: 1,
      pageSize: 500, // 获取全部
    });

    if (clothes.length < 2) {
      const weather = await getWeatherSnapshotWithCache(body.cityCode, body.date);
      return NextResponse.json({
        code: 0,
        data: {
          outfits: [],
          weather,
        },
        message: '衣橱衣服不足，无法生成推荐',
      });
    }

    // 2. 获取最近穿过的衣服（去重用）
    const recentlyWornIds = await getRecentlyWornClothingIds(userId, 3);

    // 3. 获取天气
    const weather = await getWeatherSnapshotWithCache(body.cityCode, body.date);
    const userProfile = await getUserProfile(userId);
    const recommendationProfile = normalizeRecommendationProfile(userProfile?.styleProfile);

    // 4. 调用推荐引擎
    const recommendations = generateRecommendations({
      wardrobe: clothes.map((c) =>
        toWardrobeItem({
          id: c.id,
          category: c.category,
          subcategory: c.subcategory ?? null,
          colorPalette: c.colorPalette,
          styleTags: c.styleTags,
          seasonTags: c.seasonTags,
          material: c.material ?? null,
          sceneTags: c.sceneTags,
          imageUrl: c.imageUrl,
          thumbnailUrl: c.thumbnailUrl ?? null,
          customName: c.customName ?? null,
          lastWornAt: c.lastWornAt ?? null,
          usageCount: c.usageCount ?? 0,
        }),
      ),
      preferredStyles: recommendationProfile.styleTags,
      recommendationProfile,
      weather,
      scene: body.scene,
      timeOfDay: body.timeOfDay,
      recentlyWornIds,
      excludeClothingIdSets: body.excludeClothingIdSets,
      maxResults: 3,
    });

    // 5. 保存推荐的穿搭方案到数据库
    const savedOutfits: Outfit[] = [];
    const targetDate = body.date ?? new Date().toISOString().split('T')[0]!;
    const timeOfDay = body.timeOfDay ?? 'all_day';

    for (const rec of recommendations) {
      const reusableOutfit = await findReusableOutfit({
        userId,
        clothingIds: rec.clothingIds,
        scene: rec.scene,
        targetDate,
        timeOfDay,
      });

      const outfit =
        reusableOutfit ??
        (await createOutfit({
          userId,
          title: rec.title,
          clothingIds: rec.clothingIds,
          scene: rec.scene,
          targetDate,
          timeOfDay,
          weatherSnapshot: weather as unknown as Record<string, unknown>,
          scores: rec.scores as unknown as Record<string, number>,
          scoreExplanations: rec.scoreExplanations,
          generationType: 'auto',
        }));

      // 构建返回的 Outfit 对象（含 items 详情）
      const items: OutfitItemSummary[] = rec.items.map((item) => ({
        clothingId: item.clothingId,
        category: item.category as ClothingCategory,
        subcategory: item.subcategory,
        imageUrl: item.imageUrl,
        colorPalette: item.colorPalette as { name: string; hex: string }[] | undefined,
      }));

      savedOutfits.push({
        id: outfit.id,
        userId: outfit.userId,
        title: outfit.title ?? rec.title ?? undefined,
        clothingIds: outfit.clothingIds,
        items,
        scene: outfit.scene as SceneTag | undefined,
        targetDate: outfit.targetDate ?? undefined,
        timeOfDay: outfit.timeOfDay as TimeOfDay | undefined,
        weatherSnapshot: outfit.weatherSnapshot as unknown as WeatherSnapshot | undefined,
        scores: outfit.scores as unknown as OutfitScores | undefined,
        scoreExplanations: outfit.scoreExplanations as { dimension: string; score: number; text: string }[] | undefined,
        generationType: outfit.generationType as unknown as 'auto' | 'manual' | 'from_single' | 'scene' | undefined,
        sourceItemId: outfit.sourceItemId ?? undefined,
        isFavorite: outfit.isFavorite ?? false,
        isWornToday: outfit.isWornToday ?? false,
        createdAt: outfit.createdAt.toISOString(),
        updatedAt: outfit.updatedAt.toISOString(),
        reasoning: rec.reasoning,
      });
    }

    // 6. 返回响应
    const response: RecommendResponse = {
      outfits: savedOutfits,
      weather: weather as WeatherSnapshot,
    };

    return NextResponse.json({
      code: 0,
      data: response,
      message: 'ok',
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { code: 1, data: null, message: error.message },
        { status: 401 },
      );
    }

    console.error('[outfits/recommend POST]', error);
    return NextResponse.json(
      { code: 1, data: null, message: 'recommend failed' },
      { status: 500 },
    );
  }
}
