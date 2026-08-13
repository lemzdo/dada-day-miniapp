'use strict';

const { ensureDevToolsDirectSession } = require('../devtools-direct-session');

async function probe() {
  const session = await ensureDevToolsDirectSession();
  try {
    return await session.mini.evaluate(async () => {
      const envelope = await globalThis.wx.cloud.callFunction({
        name: 'getWardrobe',
        data: { page: 1, pageSize: 50, status: 'active', includeTotal: true, includeCapacity: false },
      });
      const payload = envelope?.result?.data || envelope?.result || {};
      const list = Array.isArray(payload.list) ? payload.list : [];
      const reliable = new Set(['high', 'medium']);
      const obviousPatterns = new Set(['stripe', 'plaid', 'floral', 'graphic', 'polkaDot', 'animal', 'abstract', 'colorBlock', 'other']);
      const countBy = (values) => values.reduce((counts, value) => {
        const key = value === null || value === undefined || value === '' ? 'missing' : String(value);
        counts[key] = (counts[key] || 0) + 1;
        return counts;
      }, {});
      const features = list.map((item) => item.aestheticFeatures || null);
      const valid = features.filter((feature) => feature?.version === 1);
      const patternEligible = list.filter((item) => {
        const feature = item.aestheticFeatures;
        return feature?.version === 1
          && obviousPatterns.has(feature.patternType)
          && reliable.has(feature.confidence?.patternType);
      });
      const silhouetteEligible = list.filter((item) => {
        const feature = item.aestheticFeatures;
        if (feature?.version !== 1) return false;
        const fit = reliable.has(feature.confidence?.fit) && !['unknown', '', null, undefined].includes(feature.fit);
        const silhouette = reliable.has(feature.confidence?.silhouette) && !['unknown', '', null, undefined].includes(feature.silhouette);
        return fit || silhouette;
      });
      const categoryCounts = (items) => countBy(items.map((item) => item.category));
      let legacyTopLevel = { accessible: false };
      try {
        const db = globalThis.wx.cloud.database();
        const raw = [];
        for (let skip = 0; skip < list.length; skip += 20) {
          const page = await db.collection('clothes').where({ status: 'active' }).skip(skip).limit(20).get();
          raw.push(...(Array.isArray(page?.data) ? page.data : []));
        }
        const missingNested = raw.filter((item) => item.aestheticFeatures?.version !== 1);
        legacyTopLevel = {
          accessible: true,
          rawCount: raw.length,
          missingNestedCount: missingNested.length,
          topLevelPatternPresent: missingNested.filter((item) => item.patternType || item.pattern).length,
          topLevelFitPresent: missingNested.filter((item) => item.fit).length,
          topLevelSilhouettePresent: missingNested.filter((item) => item.silhouette).length,
          topLevelPatternValues: countBy(missingNested.map((item) => item.patternType || item.pattern)),
          topLevelFitValues: countBy(missingNested.map((item) => item.fit)),
          topLevelSilhouetteValues: countBy(missingNested.map((item) => item.silhouette)),
        };
      } catch (error) {
        legacyTopLevel = { accessible: false, errorCode: String(error?.errCode || error?.code || 'READ_FAILED') };
      }
      return {
        totalReturned: list.length,
        totalReported: payload.pagination?.total ?? null,
        categories: categoryCounts(list),
        schema: {
          aestheticPresent: features.filter(Boolean).length,
          validVersion1: valid.length,
          versions: countBy(features.map((feature) => feature?.version)),
          patternTypes: countBy(valid.map((feature) => feature.patternType)),
          fits: countBy(valid.map((feature) => feature.fit)),
          silhouettes: countBy(valid.map((feature) => feature.silhouette)),
          patternConfidence: countBy(valid.map((feature) => feature.confidence?.patternType)),
          fitConfidence: countBy(valid.map((feature) => feature.confidence?.fit)),
          silhouetteConfidence: countBy(valid.map((feature) => feature.confidence?.silhouette)),
        },
        opportunity: {
          patternEligible: patternEligible.length,
          patternEligibleCategories: categoryCounts(patternEligible),
          silhouetteEligible: silhouetteEligible.length,
          silhouetteEligibleCategories: categoryCounts(silhouetteEligible),
          patternFocusPossible: patternEligible.length >= 1 && list.length >= 2,
          topBottomSilhouettePossible: silhouetteEligible.some((item) => item.category === 'top')
            && silhouetteEligible.some((item) => item.category === 'bottom'),
        },
        legacyTopLevel,
      };
    });
  } finally {
    session.mini.disconnect();
  }
}

if (require.main === module) {
  probe().then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)).catch((error) => {
    process.stderr.write(`${error.code || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { probe };
