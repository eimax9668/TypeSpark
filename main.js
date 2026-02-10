const { app, BrowserWindow, screen, Tray, Menu, nativeImage, ipcMain } = require('electron');
const { uIOhook, UiohookKey } = require('uiohook-napi');
const path = require('path');
const fs = require('fs');
let win;
let tray;
let prefWin;
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// 設定ファイルのパスとデフォルト値
const settingsPath = path.join(app.getPath('userData'), 'settings.json');
const defaultSettings = {
  volume: 50,
  particleSize: 5,
  particleLife: 50,
  colorType: 'random',
  soundType: 'synth',
  shapeType: 'circle',
  gravity: false,
  useMousePos: false,
  screenShake: false,
  bloom: false,
  showCombo: true,
  trafficLightPosition: { x: 15, y: 20 },
  scatterIntensity: 5, // 1(弱い) 〜 10(激しい)
  enableResurgence: false, // パーティクル延命・再加速機能
  bounce: false, // 画面端での跳ね返り
  showWPM: false, // WPM表示
  enableEcho: false // エコー効果
};

let currentSettings = { ...defaultSettings };

function loadSettings() {
  try {
    return { ...defaultSettings, ...JSON.parse(fs.readFileSync(settingsPath, 'utf8')) };
  } catch (e) {
    return defaultSettings;
  }
}

function saveSettings(settings) {
  fs.writeFileSync(settingsPath, JSON.stringify(settings));
}

function createWindow() {
  // メインディスプレイのサイズを取得
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  win = new BrowserWindow({
    width: width,
    height: height,
    transparent: true, // 背景透明
    frame: false,      // 枠なし
    alwaysOnTop: true, // 最前面
    hasShadow: false,  // 影なし
    skipTaskbar: true, // タスクバーに出さない
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false // ウィンドウが非アクティブでも処理（音声など）を抑制しない
    }
  });

  win.webContents.setWindowOpenHandler(() => { return { action: 'deny' }; });
  
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) {
      event.preventDefault();
    }
  });

  // マウスイベントを完全に無視（後ろのウィンドウをクリックできるようにする）
  win.setIgnoreMouseEvents(true, { forward: true });

  win.loadFile('index.html');
}

function createPreferenceWindow() {
  // 既に開いている場合はフォーカスする
  if (prefWin && !prefWin.isDestroyed()) {
    prefWin.focus();
    return;
  }

  prefWin = new BrowserWindow({
    width: 400,
    height: 550,
    frame: false,   
    minWidth: 400,
    minHeight: 550,
    maxWidth: 400,
    maxHeight: 550,
    title: 'Preferences',
    titleBarStyle: 'hidden',
    trafficLightPosition: currentSettings.trafficLightPosition,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    }
  });

  prefWin.webContents.setWindowOpenHandler(({ url }) => {
    return { action: 'deny' };
  });
  prefWin.webContents.on('will-navigate', (event) => { event.preventDefault(); });

  prefWin.loadFile('preference.html');
}

app.whenReady().then(() => {
  // Dockアイコンを隠す (macOS用)
  if (process.platform === 'darwin') {
    app.dock.hide();
  }

  // 起動時に設定をロード
  currentSettings = loadSettings();

  createWindow();

  // メニューバー(トレイ)アイコンの設定
  let iconPath;
  if (process.platform === 'win32') {
    // Windowsの場合は icon.png を優先的に探す
    const winPath = path.join(__dirname, 'icon.png');
    iconPath = fs.existsSync(winPath) ? winPath : path.join(__dirname, 'iconTemplate.png');
  } else {
    // macOSの場合は Template 画像を使用
    iconPath = path.join(__dirname, 'iconTemplate.png');
  }

  let icon = nativeImage.createFromPath(iconPath);

  // もし画像が見つからない場合は、デフォルトの赤い四角(Base64)を使用する
  if (icon.isEmpty()) {
    const iconData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAADNGREFUOE9j/P///38GPEBfX9+/DJhmMDKaZgBZxagBdDOAbjgwagDSzQDSzQDSzQDSzQAAz1014322VQQAAAAASUVORK5CYII=';
    icon = nativeImage.createFromDataURL(iconData);
  } else {
    // 画像が読み込めた場合、メニューバーに適したサイズ(高さ16px)にリサイズする
    icon = icon.resize({ height: 16 });
    // macOSのみTemplateImage設定を適用する
    if (process.platform === 'darwin') {
      icon.setTemplateImage(true);
    }
  }
  
  tray = new Tray(icon);
  const contextMenu = Menu.buildFromTemplate([
    { label: `TypeSpark v${app.getVersion()}`, enabled: false },
    { label: 'Preferences', click: createPreferenceWindow },
    { label: 'Quit', click: () => app.quit() }
  ]);
  tray.setContextMenu(contextMenu);
  tray.setToolTip('TypeSpark');

  uIOhook.on('keydown', (e) => {
    if (win && !win.isDestroyed()) {
      let mouse = null;
      if (currentSettings.useMousePos) {
        mouse = screen.getCursorScreenPoint();
      }
      win.webContents.send('keydown-event', { keycode: e.keycode, mouse: mouse });
    }
  });

  // 設定取得リクエストへの応答
  ipcMain.handle('get-settings', () => {
    return loadSettings();
  });

  ipcMain.on('update-settings', (event, settings) => {
    const current = loadSettings();
    const newSettings = { ...current, ...settings };
    currentSettings = newSettings; // メモリ上の設定を更新
    saveSettings(newSettings);
    
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-settings', newSettings);
    }

    if (prefWin && !prefWin.isDestroyed() && settings.trafficLightPosition) {
        prefWin.setWindowButtonPosition({
            x: parseInt(settings.trafficLightPosition.x, 10),
            y: parseInt(settings.trafficLightPosition.y, 10)
        });
    }
  });

  uIOhook.start();
});

app.on('will-quit', () => {
  uIOhook.stop();
});
