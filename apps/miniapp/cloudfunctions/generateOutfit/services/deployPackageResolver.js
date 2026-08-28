'use strict';

function loadDeployPackage(packageName, vendorParts) {
  try {
    return require(packageName);
  } catch (workspaceError) {
    try {
      return require(vendorParts.join('/'));
    } catch (deployError) {
      deployError.cause = workspaceError;
      throw deployError;
    }
  }
}

module.exports = { loadDeployPackage };
