const { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, nativeImage, session, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');

// ── 창 크기 계산: 대각선 3인치, 16:9, 96 DPI 기준 ──
const DIAG_INCH = 3;
const DPI = 96;
const DIAG_RATIO = Math.hypot(16, 9); // sqrt(337)
const DEFAULT_W = Math.round((DIAG_INCH * 16 / DIAG_RATIO) * DPI); // ≈ 251
const DEFAULT_H = Math.round((DIAG_INCH * 9 / DIAG_RATIO) * DPI);  // ≈ 141

const configPath = path.join(app.getPath('userData'), 'config.json');
const startupLogPath = path.join(app.getPath('userData'), 'startup.log');

// 시작 진단 로그 (userData 폴더에 기록 — 터미널 없이도 원인 파악용)
function logStartup(msg) {
  try {
    fs.appendFileSync(startupLogPath, `[${new Date().toISOString()}] ${msg}\n`);
  } catch (e) { /* 무시 */ }
}

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(configPath, 'utf8')); }
  catch { return {}; }
}
function saveConfig(cfg) {
  try { fs.writeFileSync(configPath, JSON.stringify(cfg)); }
  catch (e) { /* 무시 */ }
}
function updateConfig(patch) {
  const cfg = loadConfig();
  Object.assign(cfg, patch);
  saveConfig(cfg);
}

let win = null;
let optionsWin = null;
let tray = null;
let currentView = 'list'; // 'list' | 'player' — 우클릭 메뉴 구성용

// ── 설정 상태 ──
const cfg0 = loadConfig();
const settings = {
  motionEnabled: cfg0.motionEnabled !== false,                              // 기본 켜짐
  motionSensitivity: Number.isFinite(cfg0.motionSensitivity) ? cfg0.motionSensitivity : 50, // 0~100
};

function createTray() {
  let icon = nativeImage.createFromPath(path.join(__dirname, 'tray.png'));
  if (icon.isEmpty()) {
    logStartup('WARN: tray.png 로드 실패 — 빈 아이콘으로 대체');
  } else if (process.platform === 'darwin') {
    // macOS 메뉴바 권장 크기(약 18pt)로 리사이즈 — 너무 크게 표시되는 것 방지
    icon = icon.resize({ width: 18, height: 18 });
  }
  tray = new Tray(icon);
  tray.setToolTip('치지직 미니 플레이어');
  const menu = Menu.buildFromTemplate([
    { label: '열기 (Ctrl+0)', click: showWindow },
    { label: '옵션…', click: createOptionsWindow },
    { type: 'separator' },
    { label: '종료', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', showWindow); // 좌클릭 → 열기
}

function createOptionsWindow() {
  if (optionsWin && !optionsWin.isDestroyed()) { optionsWin.show(); optionsWin.focus(); return; }
  optionsWin = new BrowserWindow({
    width: 380,
    height: 270,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: '치지직 미니 - 옵션',
    autoHideMenuBar: true,
    backgroundColor: '#16161a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  optionsWin.setMenuBarVisibility(false);
  optionsWin.loadFile('options.html');
  optionsWin.on('closed', () => { optionsWin = null; });
}

// 저장된 위치가 화면 밖이면 위치를 버리고 중앙에 띄움
function getSavedBounds() {
  const b = loadConfig().bounds || {};
  const w = b.width || DEFAULT_W;
  const h = b.height || DEFAULT_H;
  if (!Number.isInteger(b.x) || !Number.isInteger(b.y)) return { width: w, height: h };
  const cx = b.x + w / 2;
  const cy = b.y + h / 2;
  const inside = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return cx >= a.x && cx < a.x + a.width && cy >= a.y && cy < a.y + a.height;
  });
  return inside ? { x: b.x, y: b.y, width: w, height: h } : { width: w, height: h };
}

function createWindow() {
  const b = getSavedBounds();

  win = new BrowserWindow({
    width: b.width,
    height: b.height,
    x: Number.isInteger(b.x) ? b.x : undefined, // x/y 없으면 Electron이 화면 중앙에 배치
    y: Number.isInteger(b.y) ? b.y : undefined,
    minWidth: 160,
    minHeight: 90,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false, // 치지직 HLS CDN CORS 우회 (개인용 미니 플레이어)
    },
  });

  win.setAspectRatio(16 / 9); // 리사이징 시 16:9 유지
  win.loadFile('index.html');

  // (선택) 디버그: CHZZK_DEBUG=1 이면 렌더러 콘솔을 파일로 기록
  if (process.env.CHZZK_DEBUG) {
    const logFile = path.join(app.getPath('temp'), 'chzzk_renderer.log');
    win.webContents.on('console-message', (_e, _lvl, message) => {
      try { fs.appendFileSync(logFile, message + '\n'); } catch (e) {}
    });
  }

  // 창 위치/크기 기억
  const persist = () => { if (win && !win.isDestroyed()) updateConfig({ bounds: win.getBounds() }); };
  win.on('moved', persist);
  win.on('resize', persist);

  // 표시/숨김 → 렌더러에 알림 (숨기면 재생 중단, 열면 보던 채널 복원)
  win.on('show', () => win.webContents.send('window-shown'));
  win.on('hide', () => win.webContents.send('window-hidden'));

  // 우클릭 → 컨텍스트 메뉴 (뒤로가기 / 종료)
  win.webContents.on('context-menu', () => {
    const template = [];
    if (currentView === 'player') {
      template.push({ label: '뒤로가기', click: () => win.webContents.send('go-back') });
    }
    template.push({ label: '종료', click: () => win.hide() });
    Menu.buildFromTemplate(template).popup({ window: win });
  });

  // 실제로 닫지 않고 숨김으로 유지 (백그라운드 상주)
  win.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); win.hide(); }
  });
}

function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  win.show();
  win.focus();
}

// Ctrl+0: 보이면 숨기고, 숨겨져 있으면 보이기 (토글)
function toggleWindow() {
  if (!win || win.isDestroyed()) { createWindow(); win.show(); win.focus(); return; }
  if (win.isVisible()) win.hide();
  else { win.show(); win.focus(); }
}

// ── HTTPS GET → JSON ──
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// ── IPC ──
ipcMain.handle('get-lives', async () => {
  const j = await fetchJson('https://api.chzzk.naver.com/service/v1/lives?size=20&sortType=POPULAR');
  const list = (j.content && j.content.data) || [];
  return list.map((x) => ({
    channelId: x.channel && x.channel.channelId,
    channelName: x.channel && x.channel.channelName,
    title: x.liveTitle,
    viewers: x.concurrentUserCount,
    category: x.liveCategoryValue || '',
    thumbnail: x.channel && x.channel.channelImageUrl,
  })).filter((x) => x.channelId);
});

ipcMain.handle('get-stream', async (_e, channelId) => {
  const j = await fetchJson(`https://api.chzzk.naver.com/service/v2/channels/${channelId}/live-detail`);
  const c = j.content || {};
  if (c.status !== 'OPEN') throw new Error('방송이 종료되었거나 시청할 수 없습니다.');
  const pb = JSON.parse(c.livePlaybackJson || '{}');
  const media = (pb.media || []);
  const m = media.find((x) => x.protocol === 'LLHLS') || media.find((x) => x.protocol === 'HLS') || media[0];
  if (!m || !m.path) throw new Error('재생 가능한 스트림을 찾을 수 없습니다.');
  return { url: m.path, title: c.liveTitle };
});

ipcMain.on('hide-window', () => { if (win && !win.isDestroyed()) win.hide(); });
ipcMain.on('set-view', (_e, view) => { currentView = view; });

// ── 수동 창 드래그 (화면 아무 곳이나 잡고 이동) ──
let dragOrigin = null;
ipcMain.on('drag-start', () => { if (win && !win.isDestroyed()) dragOrigin = win.getBounds(); });
ipcMain.on('drag-move', (_e, dx, dy) => {
  if (!dragOrigin || !win || win.isDestroyed()) return;
  win.setBounds({
    x: Math.round(dragOrigin.x + dx),
    y: Math.round(dragOrigin.y + dy),
    width: dragOrigin.width,
    height: dragOrigin.height,
  });
});
ipcMain.on('drag-end', () => { dragOrigin = null; });

// ── 설정 (옵션 창 ↔ 플레이어 창 공유) ──
ipcMain.handle('get-settings', () => settings);
ipcMain.on('set-settings', (_e, patch) => {
  Object.assign(settings, patch);
  updateConfig(patch);
  if (win && !win.isDestroyed()) win.webContents.send('settings-changed', settings);
});

// ── 마지막 채널 (종료 후 재실행 복원) ──
ipcMain.handle('get-last-channel', () => loadConfig().lastChannel || null);
ipcMain.on('set-last-channel', (_e, ch) => updateConfig({ lastChannel: ch }));
ipcMain.on('clear-last-channel', () => updateConfig({ lastChannel: null }));

// ── 앱 라이프사이클 ──
// 중복 실행 방지 (이미 떠 있으면 기존 인스턴스를 열고 종료)
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.whenReady().then(() => {
    try { fs.writeFileSync(startupLogPath, ''); } catch (e) { /* 로그 초기화 */ }
    logStartup(`앱 시작 — platform=${process.platform}, electron=${process.versions.electron}`);

    // 카메라(모션 감지) 권한 허용
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(true));
    session.defaultSession.setPermissionCheckHandler(() => true);

    if (process.platform === 'darwin' && app.dock) app.dock.hide(); // macOS: 백그라운드 상주

    createWindow();                                                 // 숨김 상태로 생성

    try {
      createTray();                                                 // 트레이(메뉴바) 등록
      logStartup('트레이 생성 성공');
    } catch (e) {
      logStartup('ERROR: 트레이 생성 실패 — ' + (e && e.message));
    }

    // Ctrl/Cmd+0 → 표시/숨김 토글. 실패하면 대체 단축키 시도.
    let ok = globalShortcut.register('CommandOrControl+0', toggleWindow);
    logStartup('단축키 CommandOrControl+0 등록: ' + ok);
    if (!ok) {
      ok = globalShortcut.register('CommandOrControl+Shift+0', toggleWindow);
      logStartup('대체 단축키 CommandOrControl+Shift+0 등록: ' + ok);
    }

    // 처음 켰을 때 창을 한 번 띄워 "실행됨"을 알림 (이후 단축키/트레이로 토글)
    showWindow();
    logStartup('초기 창 표시 완료');
  });
}

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { /* 백그라운드 유지 — 종료하지 않음 */ });
app.on('before-quit', () => { app.isQuitting = true; });
