let defaultCloud = null;

try {
  defaultCloud = require('wx-server-sdk');
  defaultCloud.init({ env: defaultCloud.DYNAMIC_CURRENT_ENV });
} catch (_error) {
  defaultCloud = null;
}

const { refreshLearnedStyleProfile } = require('./profilePersistence');

function createMain({
  cloud = defaultCloud,
  refreshProfile = refreshLearnedStyleProfile,
  nowProvider = () => new Date().toISOString(),
} = {}) {
  return async function main() {
    if (!cloud) {
      return {
        code: 500,
        data: { ok: false },
        message: 'cloud sdk unavailable',
      };
    }
    const wxContext = cloud.getWXContext();
    const openid = wxContext && wxContext.OPENID;
    const db = cloud.database();
    try {
      const data = await refreshProfile({
        db,
        openid,
        now: nowProvider(),
      });
      return {
        code: 0,
        data,
        message: 'ok',
      };
    } catch (error) {
      return {
        code: 500,
        data: {
          ok: false,
          status: 'insufficient_data',
          unchanged: false,
        },
        message: error instanceof Error ? error.message : 'refresh learned style profile failed',
      };
    }
  };
}

exports.createMain = createMain;
exports.main = createMain();
