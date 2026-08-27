'use strict';

module.exports = {
  ...require('./secret-source'),
  ...require('./secret-provider'),
  ...require('./legacy-env-secret-source'),
  ...require('./encrypted-db-secret-source'),
};
