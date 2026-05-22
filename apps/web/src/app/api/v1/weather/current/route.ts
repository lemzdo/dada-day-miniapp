// ============================================================
// GET /api/v1/weather/current
// ============================================================

import { NextResponse } from 'next/server';
import { getCurrentWeatherWithCache } from '@/lib/weather/service';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const city = searchParams.get('city') ?? '上海';
    const weather = await getCurrentWeatherWithCache(city);

    return NextResponse.json({
      code: 0,
      data: weather,
      message: 'ok',
    });
  } catch (error) {
    console.error('[weather/current GET]', error);
    return NextResponse.json(
      { code: 1, data: null, message: 'weather current failed' },
      { status: 500 },
    );
  }
}
