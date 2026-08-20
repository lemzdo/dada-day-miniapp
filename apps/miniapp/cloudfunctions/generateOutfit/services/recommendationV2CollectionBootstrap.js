'use strict';

const COLLECTIONS = Object.freeze([
  'recommendation_batches_v2',
  'recommendation_outfit_refs_v2',
]);

function markerFor(collection, acceptanceRunId) {
  return `d1d-v2-bootstrap|${acceptanceRunId}|${collection}`;
}

async function ensureCollection(database, collection, acceptanceRunId) {
  const marker = markerFor(collection, acceptanceRunId);
  const existing = await database.collection(collection)
    .where({ __d1dBootstrapMarker: marker })
    .limit(1)
    .get();
  const existingDoc = existing.data?.[0];
  if (existingDoc?._id) {
    return { collection, created: false, probeRemoved: false, accessible: true };
  }
  const added = await database.collection(collection).add({
    data: { __d1dBootstrapMarker: marker, __d1dBootstrapProbe: true },
  });
  if (!added?._id) throw new Error(`V2_COLLECTION_BOOTSTRAP_ADD_FAILED:${collection}`);
  await database.collection(collection).doc(added._id).remove();
  return { collection, created: true, probeRemoved: true, accessible: true };
}

async function bootstrapRecommendationV2Collections({ database, acceptanceRunId }) {
  if (!database) throw new Error('V2_COLLECTION_BOOTSTRAP_DATABASE_REQUIRED');
  if (!acceptanceRunId) throw new Error('V2_COLLECTION_BOOTSTRAP_RUN_ID_REQUIRED');
  const collections = [];
  for (const collection of COLLECTIONS) {
    collections.push(await ensureCollection(database, collection, acceptanceRunId));
  }
  return { version: 'recommendation-v2-collection-bootstrap-v1', collections };
}

module.exports = { COLLECTIONS, markerFor, ensureCollection, bootstrapRecommendationV2Collections };
