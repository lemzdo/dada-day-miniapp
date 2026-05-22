// ============================================================
// GET /api/v1/weather/forecast
// ============================================================

import { NextResponse } from 'next/server';
import { getDailyForecastWithCache } from '@/lib/weather/service';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const city = searchParams.get('city') ?? '上海';
    const date = searchParams.get('date') ?? undefined;
    const forecast = await getDailyForecastWithCache(city, date);

    return NextResponse.json({
      code: 0,
      data: forecast,
      message: 'ok',
    });
  } catch (error) {
    console.error('[weather/forecast GET]', error);
    return NextResponse.json(
      { code: 1, data: null, message: 'weather forecast failed' },
      { status: 500 },
    );
  }
}
