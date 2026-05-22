// ============================================================
// GET /api/v1/dict/scenes
// ============================================================

import { NextResponse } from 'next/server';

const SCENES = [
  { key: '上班', label: '上班', icon: 'briefcase' },
  { key: '开会', label: '开会', icon: 'meeting' },
  { key: '出游', label: '出游', icon: 'travel' },
  { key: '约会', label: '约会', icon: 'heart' },
  { key: '逛街', label: '逛街', icon: 'shopping' },
  { key: '居家', label: '居家', icon: 'home' },
  { key: '运动', label: '运动', icon: 'sport' },
  { key: '正式', label: '正式场合', icon: 'tie' },
  { key: '聚会', label: '聚会', icon: 'party' },
];

export async function GET() {
  return NextResponse.json({
    code: 0,
    data: SCENES,
    message: 'ok',
  });
}
