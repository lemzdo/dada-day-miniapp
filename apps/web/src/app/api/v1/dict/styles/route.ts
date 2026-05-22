// ============================================================
// GET /api/v1/dict/styles
// ============================================================

import { NextResponse } from 'next/server';

const STYLES = [
  { key: '简约', label: '简约', category: '基础' },
  { key: '通勤', label: '通勤', category: '场景' },
  { key: '街头', label: '街头', category: '潮流' },
  { key: '甜美', label: '甜美', category: '风格' },
  { key: '学院', label: '学院', category: '风格' },
  { key: '复古', label: '复古', category: '风格' },
  { key: '运动', label: '运动', category: '场景' },
  { key: '优雅', label: '优雅', category: '风格' },
  { key: '休闲', label: '休闲', category: '基础' },
  { key: '辣妹', label: '辣妹', category: '潮流' },
  { key: '日系', label: '日系', category: '风格' },
  { key: '法式', label: '法式', category: '风格' },
  { key: '中性', label: '中性', category: '基础' },
];

export async function GET() {
  return NextResponse.json({
    code: 0,
    data: STYLES,
    message: 'ok',
  });
}
