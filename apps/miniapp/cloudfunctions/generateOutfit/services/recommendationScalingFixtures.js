const ROLE_ORDER = Object.freeze([
  'top', 'bottom', 'skirt', 'onepiece', 'shoes', 'outerwear', 'accessory',
]);

const ROLE_DISTRIBUTIONS = Object.freeze({
  30: { top: 7, bottom: 6, skirt: 3, onepiece: 2, shoes: 5, outerwear: 3, accessory: 4 },
  100: { top: 24, bottom: 20, skirt: 10, onepiece: 6, shoes: 16, outerwear: 10, accessory: 14 },
  300: { top: 72, bottom: 60, skirt: 30, onepiece: 18, shoes: 48, outerwear: 30, accessory: 42 },
  500: { top: 120, bottom: 100, skirt: 50, onepiece: 30, shoes: 80, outerwear: 50, accessory: 70 },
});

function fixtureItem(id, category, index) {
  const sport = category === 'top' || category === 'bottom' || category === 'shoes';
  const subcategory = category === 'top' ? `通勤衬衫 ${index}`
    : category === 'bottom' ? `通勤长裤 ${index}`
      : category === 'skirt' ? `通勤半裙 ${index}`
        : category === 'onepiece' ? `简洁连衣裙 ${index}`
          : category === 'shoes' ? `通勤鞋 ${index}`
            : category === 'outerwear' ? `薄外套 ${index}` : `配饰包 ${index}`;
  return {
    _id: id,
    category,
    type: category,
    subcategory,
    subCategory: subcategory,
    customName: subcategory,
    styleTags: sport ? ['简洁', '通勤'] : ['简洁'],
    sceneTags: ['上班'],
    seasonTags: ['春', '秋'],
    colorPalette: [{ name: index % 2 ? '黑色' : '米色', hex: index % 2 ? '#111111' : '#d9c7a2' }],
    material: '棉',
    thickness: '常规',
    confidence: 0.95,
    usageCount: index % 4,
  };
}

function buildWardrobeFromDistribution(distribution, prefix = 'scale') {
  const wardrobe = [];
  for (const role of ROLE_ORDER) {
    const count = Number(distribution?.[role] || 0);
    for (let index = 0; index < count; index += 1) {
      wardrobe.push(fixtureItem(`${prefix}-${role}-${index}`, role, index));
    }
  }
  return wardrobe;
}

function buildScalingWardrobe(size, options = {}) {
  const distribution = ROLE_DISTRIBUTIONS[size];
  if (!distribution) throw new Error(`unsupported scaling wardrobe size: ${size}`);
  return buildWardrobeFromDistribution(distribution, options.prefix || `scale-${size}`);
}

function buildWorstCaseWardrobe(size, options = {}) {
  const count = Number(size);
  if (!Number.isInteger(count) || count < 1) throw new Error(`invalid worst-case wardrobe size: ${size}`);
  // Deliberately concentrates inventory in the three Cartesian-product roles.
  const distribution = {
    top: Math.floor(count * 0.45),
    bottom: Math.floor(count * 0.35),
    skirt: 0,
    onepiece: 0,
    shoes: count - Math.floor(count * 0.45) - Math.floor(count * 0.35),
    outerwear: 0,
    accessory: 0,
  };
  return buildWardrobeFromDistribution(distribution, options.prefix || `worst-${size}`);
}

function countRoleDistribution(clothes) {
  const counts = Object.fromEntries(ROLE_ORDER.map((role) => [role, 0]));
  for (const item of Array.isArray(clothes) ? clothes : []) {
    const role = ROLE_ORDER.includes(item?.category) ? item.category : 'accessory';
    counts[role] += 1;
  }
  return counts;
}

function rawCombinationCount(roleCounts, scene = 'work') {
  const top = Number(roleCounts?.top || 0);
  const lower = Number(roleCounts?.bottom || 0) + Number(roleCounts?.skirt || 0);
  const shoes = Number(roleCounts?.shoes || 0);
  const onepiece = Number(roleCounts?.onepiece || 0);
  const core = top * lower * shoes + onepiece * shoes;
  return scene === 'home' ? core + top * lower + onepiece : core;
}

module.exports = {
  ROLE_ORDER,
  ROLE_DISTRIBUTIONS,
  buildScalingWardrobe,
  buildWorstCaseWardrobe,
  countRoleDistribution,
  rawCombinationCount,
};
