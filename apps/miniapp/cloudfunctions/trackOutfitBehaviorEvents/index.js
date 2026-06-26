const cloud = require('wx-server-sdk');
const { persistEventBatch } = require('./eventSchema');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event = {}) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const db = cloud.database();

  try {
    const result = await persistEventBatch({
      db,
      openid,
      events: event.events,
      now: new Date().toISOString(),
    });
    return {
      code: 0,
      data: result,
      message: 'ok',
    };
  } catch (error) {
    return {
      code: 400,
      data: {
        accepted: 0,
        duplicate: 0,
        rejected: 0,
        failed: 0,
        results: [],
      },
      message: error instanceof Error ? error.message : 'invalid request',
    };
  }
};
