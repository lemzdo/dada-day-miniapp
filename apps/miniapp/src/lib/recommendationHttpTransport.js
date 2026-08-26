'use strict';

function resolveRecommendationHttpTransport({ nativeCloud, frameworkCloud } = {}) {
  const candidates = [
    ['wx.cloud', nativeCloud],
    ['taro.cloud', frameworkCloud],
  ];

  for (const [source, cloud] of candidates) {
    if (!cloud || typeof cloud.callHTTPFunction !== 'function') continue;
    return {
      source,
      call(options) {
        return cloud.callHTTPFunction.call(cloud, options);
      },
    };
  }

  return null;
}

module.exports = { resolveRecommendationHttpTransport };
