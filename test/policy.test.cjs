'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { APP_ORIGIN, routeForUrl, trustedUrl, trustedDownload, microphoneRequest, microphoneCheck, restoreBounds } = require('../src/policy.cjs');

test('tab routing uses complete path segments and rejects foreign origins', () => {
  for (const route of ['book', 'admin', 'demo']) {
    assert.equal(routeForUrl(`${APP_ORIGIN}/${route}#details`), route);
    assert.equal(routeForUrl(`${APP_ORIGIN}/${route}/details`), route);
  }
  assert.equal(routeForUrl(`${APP_ORIGIN}/`), 'home');
  assert.equal(routeForUrl(`${APP_ORIGIN}/administrator`), 'home');
  assert.equal(routeForUrl('https://evil.test/admin'), null);
});

test('navigation is restricted to the exact HTTPS server origin', () => {
  assert.equal(trustedUrl(`${APP_ORIGIN}/book#assistant`), true);
  for (const url of ['http://slotpilot-beta.vercel.app', `${APP_ORIGIN}.attacker.test`,
    'https://slotpilot-beta.vercel.app@attacker.test', 'https://user:pass@slotpilot-beta.vercel.app',
    `blob:${APP_ORIGIN}/id`, 'javascript:alert(1)', 'file:///C:/Windows/System32/cmd.exe', 'ms-settings:privacy-microphone', 'invalid'])
    assert.equal(trustedUrl(url), false, url);
});

test('downloads support diagnostics blobs without allowing blob navigation or foreign downloads', () => {
  assert.equal(trustedDownload(`blob:${APP_ORIGIN}/id`), true);
  assert.equal(trustedDownload(`${APP_ORIGIN}/export`), true);
  assert.equal(trustedDownload('blob:https://evil.test/id'), false);
  assert.equal(trustedDownload('file:///C:/Windows/test.exe'), false);
});

test('microphone requests require audio only in the trusted main frame', () => {
  const details = { requestingUrl: `${APP_ORIGIN}/book`, isMainFrame: true, mediaTypes: ['audio'] };
  assert.equal(microphoneRequest('media', details), true);
  for (const change of [{ mediaTypes: ['video'] }, { mediaTypes: ['audio', 'video'] },
    { mediaTypes: [] }, { mediaTypes: undefined }, { isMainFrame: false }, { requestingUrl: 'https://evil.test/' }])
    assert.equal(microphoneRequest('media', { ...details, ...change }), false);
  for (const permission of ['display-capture', 'clipboard-read', 'geolocation', 'notifications', 'fileSystem'])
    assert.equal(microphoneRequest(permission, details), false);
});

test('permission checks deny video, subframes and foreign security origins', () => {
  const details = { requestingUrl: `${APP_ORIGIN}/book`, isMainFrame: true, mediaType: 'audio' };
  assert.equal(microphoneCheck('media', APP_ORIGIN, details), true);
  assert.equal(microphoneCheck('media', APP_ORIGIN, { ...details, mediaType: 'unknown' }), true);
  assert.equal(microphoneCheck('media', APP_ORIGIN, { ...details, mediaType: 'video' }), false);
  assert.equal(microphoneCheck('media', APP_ORIGIN, { ...details, isMainFrame: false }), false);
  assert.equal(microphoneCheck('media', APP_ORIGIN, { ...details, securityOrigin: 'https://evil.test' }), false);
  assert.equal(microphoneCheck('media', 'https://evil.test', details), false);
});

test('a saved window remains reachable after disconnecting a monitor', () => {
  assert.deepEqual(restoreBounds({ x: 3000, y: -3000, width: 2000, height: 1400 },
    { x: 0, y: 0, width: 1366, height: 768 }), { x: 0, y: 0, width: 1366, height: 768 });
  const normal = restoreBounds({}, { x: -1920, y: 0, width: 1920, height: 1080 });
  assert.equal(normal.x, -1600);
  assert.equal(normal.y, 110);
  assert.deepEqual(restoreBounds({ width: -1, height: 1, x: Infinity, y: NaN },
    { x: 0, y: 0, width: 640, height: 480 }), { x: 0, y: 0, width: 640, height: 480 });
});
