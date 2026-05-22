const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event = {}) => {
  try {
    if (!event.fileID) throw new Error('fileID is required');

    const created = await cloud.callFunction({
      name: 'uploadClothImage',
      data: { fileID: event.fileID, category: event.category || '其他' },
    });
    const item = created.result && created.result.data && created.result.data.item;
    const clothId = item && item.id;
    if (!clothId) return created.result;

    let segmented = item;
    try {
      const segmentRes = await cloud.callFunction({
        name: 'segmentClothImage',
        data: { clothId },
      });
      segmented = segmentRes.result && segmentRes.result.data ? segmentRes.result.data : item;
    } catch (error) {
      console.warn('[processClothUpload] segment failed, keeping original image', error);
    }

    if (event.recognizeNow) {
      try {
        await cloud.callFunction({
          name: 'recognizeClothAttributes',
          data: { clothId },
        });
      } catch (error) {
        console.warn('[processClothUpload] recognize failed, keeping clothing record', error);
      }
    }

    return { code: 0, data: segmented, message: 'ok' };
  } catch (error) {
    console.error('[processClothUpload] failed', error);
    return { code: 1, data: null, message: error && error.message ? error.message : 'unknown error' };
  }
};
