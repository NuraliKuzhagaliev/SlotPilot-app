'use strict';

const APP_ORIGIN = 'https://slotpilot-beta.vercel.app';
const ROUTES = Object.freeze({ home: '/', book: '/book#assistant', admin: '/admin', demo: '/demo' });

function routeForUrl(value) {
  if (!trustedUrl(value)) return null;
  const pathname = new URL(value).pathname;
  if (pathname === '/book' || pathname.startsWith('/book/')) return 'book';
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'admin';
  if (pathname === '/demo' || pathname.startsWith('/demo/')) return 'demo';
  return 'home';
}

function trustedUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === APP_ORIGIN && !url.username && !url.password;
  } catch { return false; }
}

function microphoneRequest(permission, details = {}) {
  return permission === 'media' && details.isMainFrame === true &&
    trustedUrl(details.requestingUrl) && Array.isArray(details.mediaTypes) &&
    details.mediaTypes.length > 0 && details.mediaTypes.every(type => type === 'audio');
}

function microphoneCheck(permission, origin, details = {}) {
  return permission === 'media' && details.isMainFrame === true && trustedUrl(origin) &&
    trustedUrl(details.requestingUrl) && (!details.securityOrigin || trustedUrl(details.securityOrigin)) &&
    (details.mediaType === 'audio' || details.mediaType === 'unknown');
}

function trustedDownload(value) {
  if (trustedUrl(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'blob:' && trustedUrl(value.slice(5));
  } catch { return false; }
}

function restoreBounds(saved, workArea) {
  const width = Math.min(workArea.width, Math.max(800, Number.isFinite(saved?.width) ? saved.width : 1280));
  const height = Math.min(workArea.height, Math.max(600, Number.isFinite(saved?.height) ? saved.height : 860));
  const x = Number.isFinite(saved?.x) ? saved.x : workArea.x + Math.round((workArea.width - width) / 2);
  const y = Number.isFinite(saved?.y) ? saved.y : workArea.y + Math.round((workArea.height - height) / 2);
  return {
    x: Math.round(Math.min(Math.max(x, workArea.x), workArea.x + workArea.width - width)),
    y: Math.round(Math.min(Math.max(y, workArea.y), workArea.y + workArea.height - height)),
    width: Math.round(width), height: Math.round(height),
  };
}

module.exports = { APP_ORIGIN, ROUTES, routeForUrl, trustedUrl, trustedDownload, microphoneRequest, microphoneCheck, restoreBounds };
