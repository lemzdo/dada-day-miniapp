// ============================================================
// GET /api/v1/user/capacity
// Phase 1: 接入数据库
// ============================================================

import { NextResponse } from 'next/server';
import { getUserIdFromRequest, isAuthError } from '@/lib/auth';
import { getUserCapacity } from '@/lib/db/repositories';

export async function GET(request: Request) {
  try {
    const userId = getUserIdFromRequest(request);
    const capacity = await getUserCapacity(userId);

    if (!capacity) {
      return NextResponse.json({
        code: 0,
        data: { plan: 'free', used: 0, limit: 200, total: 200, remaining: 200, canAdd: true },
        message: 'ok',
      });
    }

    return NextResponse.json({
      code: 0,
      data: capacity,
      message: 'ok',
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { code: 1, data: null, message: error.message },
        { status: 401 },
      );
    }

    console.error('[user/capacity] error:', error);
    return NextResponse.json(
      { code: 1, data: null, message: 'internal error' },
      { status: 500 },
    );
  }
}
