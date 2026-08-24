'use strict';

const crypto = require('node:crypto');
const fetch = require('node-fetch');

const SCF_API_HOST = 'scf.tencentcloudapi.com';
const SCF_API_VERSION = '2018-04-16';

async function dispatchScfEvent({
  event,
  context = {},
  functionName = readRuntimeValue(context, 'SCF_FUNCTIONNAME', 'function_name'),
  namespace = readRuntimeValue(context, 'SCF_NAMESPACE', 'namespace'),
  region = readRuntimeValue(context, 'TENCENTCLOUD_REGION', 'tencentcloud_region'),
  credentials = readRuntimeCredentials(context),
  fetchImpl = fetch,
  now = new Date(),
} = {}) {
  if (!functionName || !region) throw new Error('SCF_ASYNC_TARGET_MISSING');
  if (!credentials.secretId || !credentials.secretKey || !credentials.sessionToken) {
    throw new Error('SCF_ASYNC_CREDENTIALS_MISSING');
  }
  const body = JSON.stringify({
    FunctionName: functionName,
    InvocationType: 'Event',
    Qualifier: '$LATEST',
    ClientContext: JSON.stringify(event || {}),
    ...(namespace ? { Namespace: namespace } : {}),
  });
  const timestamp = Math.floor(now.getTime() / 1000);
  const headers = buildSignedHeaders({ body, region, credentials, timestamp, now });
  const response = await fetchImpl(`https://${SCF_API_HOST}`, {
    method: 'POST',
    headers,
    body,
    timeout: 5000,
  });
  const responseText = await response.text();
  let payload;
  try { payload = JSON.parse(responseText); } catch { throw new Error(`SCF_ASYNC_RESPONSE_JSON:${response.status}`); }
  const requestId = readText(payload?.Response?.RequestId);
  const errorCode = readText(payload?.Response?.Error?.Code);
  if (!response.ok || errorCode || !requestId) {
    throw new Error(`SCF_ASYNC_DISPATCH_FAILED:${errorCode || response.status || 'unknown'}`);
  }
  return { accepted: true, requestId };
}

function buildSignedHeaders({ body, region, credentials, timestamp, now }) {
  const contentType = 'application/json; charset=utf-8';
  const action = 'Invoke';
  const canonicalHeaders = [
    `content-type:${contentType}`,
    `host:${SCF_API_HOST}`,
    `x-tc-action:${action.toLowerCase()}`,
  ].join('\n') + '\n';
  const signedHeaders = 'content-type;host;x-tc-action';
  const hashedPayload = sha256(body);
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, hashedPayload].join('\n');
  const date = now.toISOString().slice(0, 10);
  const credentialScope = `${date}/scf/tc3_request`;
  const stringToSign = ['TC3-HMAC-SHA256', timestamp, credentialScope, sha256(canonicalRequest)].join('\n');
  const secretDate = hmac(`TC3${credentials.secretKey}`, date);
  const secretService = hmac(secretDate, 'scf');
  const secretSigning = hmac(secretService, 'tc3_request');
  const signature = hmac(secretSigning, stringToSign, 'hex');
  return {
    'Content-Type': contentType,
    Host: SCF_API_HOST,
    'X-TC-Action': action,
    'X-TC-Version': SCF_API_VERSION,
    'X-TC-Timestamp': String(timestamp),
    'X-TC-Region': region,
    'X-TC-Token': credentials.sessionToken,
    Authorization: `TC3-HMAC-SHA256 Credential=${credentials.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

function readRuntimeCredentials(context = {}) {
  return {
    secretId: readRuntimeValue(context, 'TENCENTCLOUD_SECRETID'),
    secretKey: readRuntimeValue(context, 'TENCENTCLOUD_SECRETKEY'),
    sessionToken: readRuntimeValue(context, 'TENCENTCLOUD_SESSIONTOKEN'),
  };
}

function readRuntimeValue(context, environmentKey, contextKey = environmentKey) {
  const environment = parseContextEnvironment(context);
  return readText(
    context?.[contextKey]
      || environment[environmentKey]
      || process.env[environmentKey],
  );
}

function parseContextEnvironment(context = {}) {
  if (context.environment && typeof context.environment === 'object') return context.environment;
  if (typeof context.environment === 'string') {
    try { return JSON.parse(context.environment); } catch { return {}; }
  }
  if (typeof context.environ !== 'string') return {};
  return context.environ.split(';').reduce((result, entry) => {
    const separator = entry.indexOf('=');
    if (separator > 0) result[entry.slice(0, separator)] = entry.slice(separator + 1);
    return result;
  }, {});
}

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function hmac(key, value, encoding) { return crypto.createHmac('sha256', key).update(value).digest(encoding); }
function readText(value) { return typeof value === 'string' ? value.trim() : ''; }

module.exports = {
  SCF_API_HOST,
  SCF_API_VERSION,
  buildSignedHeaders,
  dispatchScfEvent,
  parseContextEnvironment,
  readRuntimeCredentials,
};
