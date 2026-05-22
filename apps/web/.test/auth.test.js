"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/lib/auth.test.ts
var import_node_test = __toESM(require("node:test"));
var import_strict = __toESM(require("node:assert/strict"));

// src/lib/auth.ts
var import_crypto = require("crypto");
var DEV_USER_ID = "mock-user-001";
var LEGACY_TOKEN_PREFIX = "token-";
var SIGNED_TOKEN_PREFIX = "d1d.";
var TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
var AuthError = class extends Error {
  constructor(message = "unauthorized") {
    super(message);
    this.name = "AuthError";
  }
};
function getBearerToken(request) {
  const authHeader = request.headers.get("authorization") ?? "";
  const [scheme, token] = authHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }
  return token;
}
function createAuthToken(userId, now = /* @__PURE__ */ new Date()) {
  const issuedAt = Math.floor(now.getTime() / 1e3);
  const payload = {
    sub: userId,
    iat: issuedAt,
    exp: issuedAt + TOKEN_TTL_SECONDS,
    v: 1
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = sign(encodedPayload);
  return `${SIGNED_TOKEN_PREFIX}${encodedPayload}.${signature}`;
}
function getUserIdFromRequest(request) {
  const token = getBearerToken(request);
  if (!token) {
    if (isDevAuthEnabled()) return DEV_USER_ID;
    throw new AuthError("missing token");
  }
  const verifiedUserId = verifyAuthToken(token);
  if (verifiedUserId) return verifiedUserId;
  if (isDevAuthEnabled() && token.startsWith(LEGACY_TOKEN_PREFIX)) {
    return token.slice(LEGACY_TOKEN_PREFIX.length) || DEV_USER_ID;
  }
  throw new AuthError("invalid token");
}
function verifyAuthToken(token) {
  if (!token.startsWith(SIGNED_TOKEN_PREFIX)) return null;
  const unsigned = token.slice(SIGNED_TOKEN_PREFIX.length);
  const [encodedPayload, signature] = unsigned.split(".");
  if (!encodedPayload || !signature) return null;
  const expected = sign(encodedPayload);
  if (!safeEqual(signature, expected)) return null;
  const payload = parsePayload(encodedPayload);
  if (!payload) return null;
  const now = Math.floor(Date.now() / 1e3);
  if (payload.exp <= now) return null;
  return payload.sub;
}
function parsePayload(encodedPayload) {
  try {
    const json = Buffer.from(encodedPayload, "base64url").toString("utf8");
    const payload = JSON.parse(json);
    if (payload.v !== 1 || typeof payload.sub !== "string" || typeof payload.iat !== "number" || typeof payload.exp !== "number") {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
function sign(value) {
  return (0, import_crypto.createHmac)("sha256", getAuthSecret()).update(value).digest("base64url");
}
function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && (0, import_crypto.timingSafeEqual)(leftBuffer, rightBuffer);
}
function encodeBase64Url(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}
function getAuthSecret() {
  const secret = process.env["AUTH_TOKEN_SECRET"] ?? process.env["NEXTAUTH_SECRET"];
  if (secret) return secret;
  if (isDevAuthEnabled()) return "d1d-dev-auth-secret";
  throw new AuthError("auth secret is not configured");
}
function isDevAuthEnabled() {
  return process.env["NODE_ENV"] !== "production" || process.env["D1D_ENABLE_DEV_AUTH"] === "true";
}

// src/lib/auth.test.ts
(0, import_node_test.default)("createAuthToken signs a token accepted by getUserIdFromRequest", () => {
  process.env["AUTH_TOKEN_SECRET"] = "test-secret";
  const token = createAuthToken("user-123", /* @__PURE__ */ new Date("2026-05-19T00:00:00.000Z"));
  const request = new Request("http://localhost/api/v1/user/profile", {
    headers: { Authorization: `Bearer ${token}` }
  });
  import_strict.default.equal(getUserIdFromRequest(request), "user-123");
});
(0, import_node_test.default)("getUserIdFromRequest rejects tampered signed tokens", () => {
  process.env["AUTH_TOKEN_SECRET"] = "test-secret";
  const token = createAuthToken("user-123");
  const tampered = `${token.slice(0, -2)}xx`;
  const request = new Request("http://localhost/api/v1/user/profile", {
    headers: { Authorization: `Bearer ${tampered}` }
  });
  import_strict.default.throws(() => getUserIdFromRequest(request), AuthError);
});
(0, import_node_test.default)("getUserIdFromRequest supports legacy dev tokens outside production", () => {
  const request = new Request("http://localhost/api/v1/user/profile", {
    headers: { Authorization: "Bearer token-dev-user" }
  });
  import_strict.default.equal(getUserIdFromRequest(request), "dev-user");
});
