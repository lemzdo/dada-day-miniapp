const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const now = new Date().toISOString();

  try {
    const type = typeof event.type === 'string' ? event.type.trim() : '';
    const content = typeof event.content === 'string' ? event.content.trim() : '';
    const contact = typeof event.contact === 'string' ? event.contact.trim() : '';
    const images = Array.isArray(event.images) ? event.images.filter((item) => typeof item === 'string') : [];

    if (!type) throw new Error('feedback type is required');
    if (!content && images.length === 0) throw new Error('feedback content or image is required');

    const addRes = await db.collection('user_feedback').add({
      data: {
        _openid: OPENID,
        type,
        content,
        contact,
        images,
        page: typeof event.page === 'string' ? event.page : '',
        systemInfo: event.systemInfo && typeof event.systemInfo === 'object' ? event.systemInfo : {},
        createdAt: now,
        updatedAt: now,
        status: 'new',
      },
    });

    return ok({ id: addRes._id, status: 'new' });
  } catch (error) {
    return fail(error);
  }
};

function ok(data) {
  return { code: 0, data, message: 'ok' };
}

function fail(error) {
  return { code: 1, data: null, message: error && error.message ? error.message : 'unknown error' };
}
