'use strict';
// Runs the real Electron application. No credentials, bookings or voice API calls.
const { app, BrowserWindow, Menu, dialog } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
app.setPath('userData', path.resolve(__dirname, '../test-output/profile'));
dialog.showMessageBox = async () => { throw new Error('Unexpected navigation dialog'); };
require('../src/main.cjs');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await wait(250);
  }
  throw new Error(`Timed out: ${label}`);
}
async function run() {
  await app.whenReady();
  let win;
  await until(() => { win = BrowserWindow.getAllWindows()[0]; return win && win.contentView.children.length > 0; }, 'application window');
  const view = win.contentView.children.find(child => child.webContents);
  const wc = view.webContents;
  const shell = code => win.webContents.executeJavaScript(code);
  await until(async () => await shell("document.querySelector('#status')?.dataset.kind === 'ready'"), 'online page');
  assert.equal(await shell('document.documentElement.lang'), 'en');
  assert.equal(await shell("document.querySelector('[data-command=book]').textContent"), 'Book a visit');
  assert.equal(await shell("document.querySelector('#status').textContent"), 'Connected');
  assert.equal(await wc.executeJavaScript('navigator.language'), 'en-US');
  const menuLabels = menu => menu.items.flatMap(item => [item.label, ...(item.submenu ? menuLabels(item.submenu) : [])]);
  assert.equal(/[\u0400-\u04ff]/u.test(menuLabels(Menu.getApplicationMenu()).join(' ')), false);
  console.log('PASS: English shell, native menus and Chromium language');
  assert.match(wc.getURL(), /^https:\/\/slotpilot-beta\.vercel\.app\/book/);
  const preferences = wc.getLastWebPreferences();
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.webSecurity, true);
  assert.equal(preferences.preload, undefined);
  assert.equal(await wc.executeJavaScript('typeof window.require'), 'undefined');
  assert.equal(await wc.executeJavaScript('typeof window.slotpilotDesktop'), 'undefined');
  assert.equal(await wc.executeJavaScript('window.isSecureContext && !!navigator.mediaDevices?.getUserMedia && !!window.AudioWorkletNode'), true);
  console.log('PASS: real HTTPS page, isolated renderer, microphone and AudioWorklet APIs available');

  const output = path.resolve(__dirname, '../test-output');
  fs.mkdirSync(output, { recursive: true });
  await wait(750);
  try { fs.writeFileSync(path.join(output, 'online.png'), (await wc.capturePage()).toPNG()); }
  catch { console.log('INFO: screenshot unavailable from Chromium compositor'); }
  win.setSize(960, 720);
  await wait(300);
  assert.equal(view.getBounds().height, win.getContentBounds().height - 60);
  console.log('PASS: native window resize');

  const before = wc.getURL();
  await wc.executeJavaScript("window.open('https://example.com')");
  await wait(400);
  assert.equal(BrowserWindow.getAllWindows().length, 1);
  assert.equal(wc.getURL(), before);
  await assert.rejects(wc.executeJavaScript("window.slotpilotDesktop.command('admin')"));
  console.log('PASS: blocked foreign popups and remote privileged bridge');

  await wc.executeJavaScript("history.pushState({}, '', '/book#desktop-smoke')");
  await wait(300);
  assert.equal(await shell("document.querySelector('#status').dataset.kind"), 'ready');
  console.log('PASS: in-page navigation remains ready');

  await wc.executeJavaScript("window.__tabPreservationTest = 'unsaved form marker'");
  await shell("window.slotpilotDesktop.command('admin')");
  await until(async () => await shell("document.querySelector('button[data-command=admin]').getAttribute('aria-selected') === 'true' && document.querySelector('#status').dataset.kind === 'ready'"), 'admin tab');
  assert.equal(win.contentView.children.length, 2);
  const adminView = win.contentView.children.find(child => child.webContents && child !== view);
  assert.equal(view.getVisible(), false);
  assert.equal(adminView.getVisible(), true);
  await shell("window.slotpilotDesktop.command('book')");
  assert.equal(await wc.executeJavaScript('window.__tabPreservationTest'), 'unsaved form marker');
  assert.equal(view.getVisible(), true);
  assert.equal(adminView.getVisible(), false);
  console.log('PASS: immediate desktop tabs without a dialog, original document and unsaved state retained');

  await wc.executeJavaScript("(() => { const a = document.createElement('a'); a.href = '/admin'; document.body.append(a); a.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true})); a.remove(); })()");
  await until(async () => await shell("document.querySelector('button[data-command=admin]').getAttribute('aria-selected') === 'true'"), 'cross-section link');
  assert.equal(win.contentView.children.length, 2);
  assert.equal(await wc.executeJavaScript('window.__tabPreservationTest'), 'unsaved form marker');
  await shell("window.slotpilotDesktop.command('book')");
  console.log('PASS: in-page cross-section links reuse the correct tab, no duplicate page or window');

  wc.session.webRequest.onBeforeRequest({ urls: ['https://slotpilot-beta.vercel.app/*'] }, (_details, callback) => callback({ cancel: true }));
  await adminView.webContents.loadURL(`https://slotpilot-beta.vercel.app/admin?desktop-test=${Date.now()}`).catch(() => {});
  assert.equal(await shell("document.querySelector('#status').dataset.kind"), 'ready');
  assert.equal(view.getVisible(), true);
  wc.session.webRequest.onBeforeRequest(null);
  console.log('PASS: a failed background tab cannot replace the active page with its error');

  await wc.session.clearCache();
  wc.session.enableNetworkEmulation({ offline: true });
  // Network emulation can still serve an HTTP cache entry. Cancel the main request
  // as well so this scenario deterministically exercises a failed document load.
  wc.session.webRequest.onBeforeRequest({ urls: ['https://slotpilot-beta.vercel.app/*'] }, (_details, callback) => callback({ cancel: true }));
  await wc.loadURL(`https://slotpilot-beta.vercel.app/book?desktop-test=${Date.now()}`).catch(() => {});
  await until(async () => await shell("document.querySelector('#status').dataset.kind === 'error'"), 'offline screen');
  assert.equal(view.getVisible(), false);
  assert.equal(await shell("document.querySelector('#heading').textContent"), 'Unable to connect');
  assert.equal(await shell("document.querySelector('#retry').textContent"), 'Try again');
  try { fs.writeFileSync(path.join(output, 'offline.png'), (await win.webContents.capturePage()).toPNG()); }
  catch { console.log('INFO: screenshot unavailable from Chromium compositor'); }
  console.log('PASS: offline error screen, no invented booking result');
  wc.session.disableNetworkEmulation();
  wc.session.webRequest.onBeforeRequest(null);
  await shell("window.slotpilotDesktop.command('retry')");
  await until(async () => await shell("document.querySelector('#status').dataset.kind === 'ready'"), 'retry');
  assert.equal(view.getVisible(), true);
  console.log('PASS: reconnect using the local retry control');
  await shell("window.slotpilotDesktop.command('reload')");
  await until(async () => await shell("document.querySelector('#status').dataset.kind === 'ready'"), 'reload');
  console.log('PASS: reload without a confirmation dialog');
  const cookies = await wc.session.cookies.get({ url: 'https://slotpilot-beta.vercel.app' });
  console.log(`INFO: persistent cookie session active (${cookies.length} cookies; contents omitted)`);
  console.log('NOT TESTED: account login, real booking, physical microphone, voice provider, audible interruption');
  app.exit(0);
}
run().catch(error => { console.error(error.message); app.exit(1); });
