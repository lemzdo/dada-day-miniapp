const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const BATCH_SIZE = 100;

const OLD_IMAGE_FIELDS = [
  'fileID',
  'originalFileID',
  'imageUrl',
  'cutoutImageUrl',
  'whiteBgImageUrl',
  'maskImageUrl',
  'manualCropImageUrl',
];

exports.main = async (event = {}) => {
  try {
    const { OPENID } = cloud.getWXContext();
    const cleanAllUsers = Boolean(event.allUsers);
    const dryRun = Boolean(event.dryRun);
    const filter = cleanAllUsers ? {} : { _openid: OPENID };
    const collection = db.collection('clothes');
    let scanned = 0;
    let updated = 0;

    while (true) {
      const res = await collection.where(filter).skip(scanned).limit(BATCH_SIZE).get();
      const list = res.data || [];
      if (!list.length) break;

      for (const item of list) {
        if (!hasOldImageFields(item)) continue;
        updated += 1;
        if (dryRun) continue;

        await collection.doc(item._id).update({
          data: buildUnsetData(),
        });
      }

      scanned += list.length;
      if (list.length < BATCH_SIZE) break;
    }

    return ok({
      dryRun,
      scope: cleanAllUsers ? 'allUsers' : 'currentUser',
      scanned,
      updated,
      removedFields: OLD_IMAGE_FIELDS,
    });
  } catch (error) {
    console.error('[cleanupClothingImageFields] failed', error);
    return fail(error);
  }
};

function hasOldImageFields(item) {
  return OLD_IMAGE_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(item, field));
}

function buildUnsetData() {
  return OLD_IMAGE_FIELDS.reduce((data, field) => {
    data[field] = _.remove();
    return data;
  }, {});
}

function ok(data) {
  return { code: 0, data, message: 'ok' };
}

function fail(error) {
  return { code: 1, data: null, message: error && error.message ? error.message : 'unknown error' };
}
