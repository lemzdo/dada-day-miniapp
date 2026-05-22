// ============================================================
// POST /api/v1/auth/wechat-login
// Phase 1: 接入数据库，创建/查找用户
// ============================================================

import { NextResponse } from 'next/server';
import { createAuthToken } from '@/lib/auth';
import { createUser, findUserByOpenid } from '@/lib/db/repositories';

interface WechatSession {
  openid?: string;
  session_key?: string;
  unionid?: string;
  errcode?: number;
  errmsg?: string;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const code = body?.['code'] as string | undefined;

    if (!code) {
      return NextResponse.json(
        { code: 1, data: null, message: 'code is required' },
        { status: 400 },
      );
    }

    const session = await resolveWechatSession(code);

    // 查找已有用户，不存在则创建
    let user = await findUserByOpenid(session.openid);
    if (!user) {
      user = await createUser({
        wechatOpenid: session.openid,
        unionid: session.unionid,
        nickname: '搭搭新朋友',
      });
    }

    if (!user) {
      return NextResponse.json(
        { code: 1, data: null, message: 'failed to create user' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      code: 0,
      data: {
        token: createAuthToken(user.id),
        user: {
          id: user.id,
          name: user.nickname ?? '搭搭新朋友',
          avatar: user.avatarUrl ?? '',
        },
      },
      message: 'ok',
    });
  } catch (error) {
    console.error('[auth/wechat-login] error:', error);
    return NextResponse.json(
      { code: 1, data: null, message: 'login failed' },
      { status: 500 },
    );
  }
}

async function resolveWechatSession(code: string): Promise<{ openid: string; unionid?: string }> {
  const appId = process.env['WECHAT_APP_ID'];
  const appSecret = process.env['WECHAT_APP_SECRET'];

  if (shouldUseDevWechatSession(code)) {
    return { openid: `dev-${code}` };
  }

  if (!appId || !appSecret) {
    if (isDevAuthAllowed()) {
      return { openid: `dev-${code}` };
    }
    throw new Error('wechat app credentials are not configured');
  }

  const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
  url.searchParams.set('appid', appId);
  url.searchParams.set('secret', appSecret);
  url.searchParams.set('js_code', code);
  url.searchParams.set('grant_type', 'authorization_code');

  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`wechat code2Session failed: ${response.status}`);
  }

  const data = (await response.json()) as WechatSession;
  if (data.errcode) {
    throw new Error(`wechat code2Session error ${data.errcode}: ${data.errmsg ?? 'unknown'}`);
  }
  if (!data.openid) {
    throw new Error('wechat code2Session missing openid');
  }

  return {
    openid: data.openid,
    unionid: data.unionid,
  };
}

function shouldUseDevWechatSession(code: string): boolean {
  return isDevAuthAllowed() && (code === 'dev-mock' || code === 'web-demo');
}

function isDevAuthAllowed(): boolean {
  return process.env['NODE_ENV'] !== 'production' || process.env['D1D_ENABLE_DEV_AUTH'] === 'true';
}
