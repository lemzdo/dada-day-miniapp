// ============================================================
// GET /api/v1/dict/categories
// ============================================================

import { NextResponse } from 'next/server';

const CATEGORIES = [
  {
    key: 'top',
    label: '上衣',
    children: [
      { key: 'tshirt', label: 'T恤' },
      { key: 'shirt', label: '衬衫' },
      { key: 'sweater', label: '毛衣' },
      { key: 'hoodie', label: '卫衣' },
      { key: 'jacket', label: '外套' },
      { key: 'down_jacket', label: '羽绒服' },
      { key: 'blazer', label: '西装' },
      { key: 'vest', label: '背心' },
    ],
  },
  {
    key: 'bottom',
    label: '下装',
    children: [
      { key: 'jeans', label: '牛仔裤' },
      { key: 'trousers', label: '长裤' },
      { key: 'shorts', label: '短裤' },
      { key: 'skirt', label: '半身裙' },
      { key: 'leggings', label: '打底裤' },
    ],
  },
  {
    key: 'onepiece',
    label: '连体',
    children: [
      { key: 'dress', label: '连衣裙' },
      { key: 'suit_set', label: '套装' },
      { key: 'jumpsuit', label: '连体裤' },
    ],
  },
  {
    key: 'shoes',
    label: '鞋子',
    children: [
      { key: 'sneakers', label: '运动鞋' },
      { key: 'heels', label: '高跟鞋' },
      { key: 'boots', label: '靴子' },
      { key: 'sandals', label: '凉鞋' },
      { key: 'loafers', label: '乐福鞋' },
      { key: 'flats', label: '平底鞋' },
    ],
  },
  {
    key: 'accessory',
    label: '配饰',
    children: [
      { key: 'hat', label: '帽子' },
      { key: 'scarf', label: '围巾' },
      { key: 'necklace', label: '项链' },
      { key: 'bag', label: '包包' },
      { key: 'glasses', label: '眼镜' },
      { key: 'belt', label: '腰带' },
      { key: 'watch', label: '手表' },
    ],
  },
  {
    key: 'other',
    label: '其他',
    children: [{ key: 'other', label: '其他' }],
  },
];

export async function GET() {
  return NextResponse.json({
    code: 0,
    data: CATEGORIES,
    message: 'ok',
  });
}
