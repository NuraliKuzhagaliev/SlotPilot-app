'use strict';
const { app, BrowserWindow, WebContentsView, Menu, session, ipcMain, dialog, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { APP_ORIGIN, ROUTES, routeForUrl, trustedUrl, trustedDownload, microphoneRequest, microphoneCheck, restoreBounds } = require('./policy.cjs');

const SHELL = pathToFileURL(path.join(__dirname, 'shell.html')).href;
const HEADER_HEIGHT = 60;
const navigationScript = fs.readFileSync(path.join(__dirname, 'navigation.js'), 'utf8');
const tabs = new Map();
let window, view, remoteSession, preferences, preferencesFile;
let state = { kind: 'loading', route: 'book' };
let microphonePrompt;

app.setName('SlotPilot');
app.commandLine.appendSwitch('lang', 'en-US');
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show(); window.focus();
  });
  app.whenReady().then(createApplication).catch(() => {
    dialog.showErrorBox('SlotPilot', 'Unable to start the application. Close SlotPilot and try again.');
    app.quit();
  });
}
app.on('window-all-closed', () => app.quit());

function savePreferences() {
  try {
    const temporary = `${preferencesFile}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(preferences), { mode: 0o600 });
    fs.renameSync(temporary, preferencesFile);
  } catch { /* Settings must not prevent startup or shutdown. */ }
}

function publish() {
  state = { kind: tabs.get(state.route)?.kind || 'loading', route: state.route,
    tabs: [...tabs.values()].map(tab => ({ route: tab.route, kind: tab.kind, audible: tab.audible })) };
  if (!window?.isDestroyed()) window.webContents.send('desktop:state', state);
}

function visibility() {
  for (const tab of tabs.values()) tab.view.setVisible(tab.route === state.route && tab.kind === 'ready');
}

function failure(tab) {
  tab.failed = true;
  clearTimeout(tab.timer);
  tab.kind = 'error';
  visibility();
  publish();
}

function resize() {
  if (!window || !view) return;
  const { width, height } = window.getContentBounds();
  for (const tab of tabs.values()) tab.view.setBounds({ x: 0, y: HEADER_HEIGHT, width, height: Math.max(0, height - HEADER_HEIGHT) });
}

async function loadTab(tab, url = tab.url) {
  clearTimeout(tab.timer);
  tab.url = url;
  tab.kind = 'loading';
  tab.failed = false;
  visibility();
  publish();
  tab.timer = setTimeout(() => { tab.view.webContents.stop(); failure(tab); }, 30000);
  try { await tab.view.webContents.loadURL(url); }
  catch { /* did-fail-load owns the error screen; aborted navigations are ignored. */ }
}

async function approveMicrophone() {
  if (preferences.microphone === true) return true;
  if (preferences.microphone === false) return false;
  if (!microphonePrompt) microphonePrompt = dialog.showMessageBox(window, {
    type: 'question', title: 'SlotPilot microphone',
    message: 'Allow SlotPilot to use your microphone for conversations?',
    detail: 'Your microphone starts when you press the voice assistant button. Speech is sent to AssemblyAI for processing. Camera and screen capture are not allowed.',
    buttons: ['Allow', 'Not now'], defaultId: 1, cancelId: 1,
  }).then(({ response }) => {
    preferences.microphone = response === 0;
    savePreferences();
    return preferences.microphone;
  }).finally(() => { microphonePrompt = undefined; });
  return microphonePrompt;
}

async function changeMicrophone() {
  const { response } = await dialog.showMessageBox(window, {
    type: 'question', title: 'SlotPilot microphone', message: 'Microphone access',
    detail: `Currently ${preferences.microphone === true ? 'allowed' : 'not allowed'}. Disabling access stops the current conversation. If Windows blocks access, check Settings → Privacy & security → Microphone → Let desktop apps access your microphone.`,
    buttons: ['Allow', 'Disable', 'Cancel'], defaultId: 2, cancelId: 2,
  });
  if (response === 2) return;
  preferences.microphone = response === 0;
  savePreferences();
  if (response === 1) await Promise.all([...tabs.values()].map(tab => loadTab(tab)));
}

async function navigate(route, force = false, url) {
  if (!Object.hasOwn(ROUTES, route)) return;
  const isNew = !tabs.has(route);
  const tab = tabs.get(route) || createTab(route);
  state.route = route;
  view = tab.view;
  resize();
  visibility();
  publish();
  if (isNew || force) await loadTab(tab, url || (force ? tab.url : APP_ORIGIN + ROUTES[route]));
  if (tab.route === state.route && tab.kind === 'ready') tab.view.webContents.focus();
}

function createTab(route) {
  const tabView = new WebContentsView({ webPreferences: {
    session: remoteSession, sandbox: true, contextIsolation: true, nodeIntegration: false,
    webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, backgroundThrottling: false,
  } });
  const tab = { route, view: tabView, url: APP_ORIGIN + ROUTES[route], kind: 'loading', failed: false, audible: false, timer: undefined };
  tabs.set(route, tab);
  window.contentView.addChildView(tabView);
  tabView.setVisible(false);
  const wc = tabView.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    const target = routeForUrl(url);
    if (target) void navigate(target, false, url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (event, url) => {
    const target = routeForUrl(url);
    if (!target) { event.preventDefault(); return; }
    if (target !== tab.route) { event.preventDefault(); void navigate(target, false, url); }
  });
  wc.on('will-redirect', (event, url) => { if (!trustedUrl(url)) { event.preventDefault(); failure(tab); } });
  wc.on('will-attach-webview', event => event.preventDefault());
  wc.on('did-start-navigation', details => {
    if (details.isMainFrame && trustedUrl(details.url)) {
      tab.url = details.url;
      if (!details.isSameDocument) { tab.failed = false; tab.kind = 'loading'; }
      publish();
    }
  });
  wc.on('did-navigate-in-page', (_event, url, mainFrame) => {
    if (mainFrame && trustedUrl(url) && !tab.failed) { tab.url = url; tab.kind = 'ready'; visibility(); publish(); }
  });
  wc.on('did-navigate', (_event, url, status) => {
    if (status >= 400 || !trustedUrl(url)) failure(tab);
  });
  wc.on('did-finish-load', () => {
    clearTimeout(tab.timer);
    if (tab.failed || !trustedUrl(wc.getURL())) { failure(tab); return; }
    tab.kind = 'ready';
    void wc.executeJavaScript(navigationScript).catch(() => {});
    visibility();
    publish();
  });
  wc.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
    if (mainFrame && code !== -3) failure(tab);
  });
  wc.on('render-process-gone', () => failure(tab));
  wc.on('media-started-playing', () => { tab.audible = true; publish(); });
  wc.on('media-paused', () => { tab.audible = false; publish(); });
  return tab;
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'SlotPilot', submenu: [
      { label: 'Book a visit', click: () => void navigate('book') },
      { label: 'Admin', click: () => void navigate('admin') },
      { label: 'Demo', click: () => void navigate('demo') },
      { type: 'separator' },
      { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => void navigate(state.route, true) },
      { type: 'separator' }, { role: 'quit', label: 'Quit' },
    ] },
    { label: 'Edit', submenu: [
      { role: 'undo', label: 'Undo' }, { role: 'redo', label: 'Redo' },
      { type: 'separator' }, { role: 'cut', label: 'Cut' }, { role: 'copy', label: 'Copy' },
      { role: 'paste', label: 'Paste' }, { role: 'selectAll', label: 'Select all' },
    ] },
    { label: 'View', submenu: [
      { label: 'Zoom in', accelerator: 'CmdOrCtrl+Plus', click: () => zoom(.1) },
      { label: 'Zoom out', accelerator: 'CmdOrCtrl+-', click: () => zoom(-.1) },
      { label: 'Actual size', accelerator: 'CmdOrCtrl+0', click: () => view.webContents.setZoomFactor(1) },
      { role: 'togglefullscreen', label: 'Full screen' },
    ] },
    { label: 'Help', submenu: [
      { label: 'Microphone', click: () => void changeMicrophone() },
      { label: 'About SlotPilot', click: () => void about() },
    ] },
  ]));
}
function zoom(delta) { view.webContents.setZoomFactor(Math.max(.75, Math.min(1.5, view.webContents.getZoomFactor() + delta))); }
function about() {
  return dialog.showMessageBox(window, {
    type: 'info', title: 'SlotPilot', message: `SlotPilot ${app.getVersion()} for Windows`,
    detail: `Car service booking and voice assistant.\nServer: ${APP_ORIGIN}\nAn internet connection is required for bookings and the AI assistant.\nDemo data does not represent real workshop offers.`,
  });
}

async function createApplication() {
  app.setAppUserModelId('app.slotpilot.desktop');
  preferencesFile = path.join(app.getPath('userData'), 'desktop-settings.json');
  try { preferences = JSON.parse(fs.readFileSync(preferencesFile, 'utf8')); }
  catch { preferences = {}; }
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) preferences = {};
  const area = screen.getPrimaryDisplay().workArea;
  window = new BrowserWindow({
    ...restoreBounds(preferences.bounds, area), minWidth: Math.min(800, area.width), minHeight: Math.min(600, area.height),
    title: 'SlotPilot', backgroundColor: '#101722', show: false,
    icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true },
  });
  remoteSession = session.fromPartition('persist:slotpilot-server');
  remoteSession.setUserAgent(remoteSession.getUserAgent(), 'en-US,en');
  const owns = wc => [...tabs.values()].some(tab => tab.view.webContents === wc);

  window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  remoteSession.setPermissionCheckHandler((wc, permission, origin, details) =>
    owns(wc) && preferences.microphone === true && microphoneCheck(permission, origin, details));
  remoteSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (!owns(wc) || !microphoneRequest(permission, details)) return callback(false);
    const requestUrl = details.requestingUrl;
    approveMicrophone().then(allowed => callback(allowed && !wc.isDestroyed() && wc.getURL() === requestUrl), () => callback(false));
  });
  remoteSession.on('will-download', (event, item) => {
    if (!trustedDownload(item.getURL())) { event.preventDefault(); return; }
    // Chromium uses the native save dialog. Never pick a filesystem path from remote arguments.
    item.setSaveDialogOptions({ title: 'Save SlotPilot file' });
  });

  window.on('resize', resize);
  window.on('close', () => {
    preferences.bounds = window.getNormalBounds();
    preferences.maximized = window.isMaximized();
    savePreferences();
    for (const tab of tabs.values()) {
      clearTimeout(tab.timer);
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    }
  });

  ipcMain.handle('desktop:command', async (event, command) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== SHELL)
      throw new Error('Forbidden sender');
    if (command === 'state') { publish(); return; }
    if (command === 'retry') { if (state.kind === 'error') await loadTab(tabs.get(state.route)); return; }
    if (command === 'reload') { await navigate(state.route, true); return; }
    if (command === 'microphone') { await changeMicrophone(); return; }
    if (command === 'about') { await about(); return; }
    if (typeof command === 'string' && Object.hasOwn(ROUTES, command)) { await navigate(command); return; }
    throw new Error('Unknown command');
  });
  buildMenu();
  await window.loadFile(path.join(__dirname, 'shell.html'));
  if (preferences.maximized === true) window.maximize();
  window.show();
  await navigate('book');
}
