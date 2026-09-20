'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('login remote success is committed before bounded local resume persistence', () => {
  const source = fs.readFileSync(path.join(__dirname, '../stores/userStore.ts'), 'utf8');
  const stateCommit = source.indexOf('set({\n      recommendationProfile');
  const persistence = source.indexOf('bootstrapProjectionStore.writeAuthResume');
  assert.ok(stateCommit >= 0);
  assert.ok(persistence > stateCommit);
  assert.match(source, /Local persistence is a bounded[\s\S]*never reverses an authenticated runtime/);
});

test('weather remote success is returned even when local cache persistence is skipped', () => {
  const source = fs.readFileSync(path.join(__dirname, 'cloud.ts'), 'utf8');
  const functionStart = source.indexOf('export async function getCloudWeather');
  const functionEnd = source.indexOf('export function getLocalStyles', functionStart);
  const body = source.slice(functionStart, functionEnd);
  assert.match(body, /writeLocalWeatherCache\(data\);[\s\S]*return data;/);
  assert.doesNotMatch(body, /clearLocalWeatherCache\(\)/);
});
