const { app, BrowserWindow, screen, Tray, Menu, nativeImage, ipcMain } = require('electron');
const { uIOhook, UiohookKey } = require('uiohook-napi');
const path = require('path');
const fs = require('fs');
let win;
let tray;
let prefWin;

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
  showWPM: false // WPM表示
};

// メモリ上で設定を保持（ディスク読み込みを減らすため）
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
    }
  });

  // マウスイベントを完全に無視（後ろのウィンドウをクリックできるようにする）
  win.setIgnoreMouseEvents(true, { forward: true });

  win.loadFile('index.html');
  
  // 開発者ツールを開きたい場合はコメントアウトを外す
  // win.webContents.openDevTools({ mode: 'detach' });
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
  // macOSで自動色反転させるため 'iconTemplate.png' を読み込む
  // (ファイル名の末尾に "Template" をつけるとmacOSが自動で色を調整します)
  const iconPath = path.join(__dirname, 'iconTemplate.png');
  let icon = nativeImage.createFromPath(iconPath);

  // もし画像が見つからない場合は、デフォルトの赤い四角(Base64)を使用する
  if (icon.isEmpty()) {
    const iconData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAADNGREFUOE9j/P///38GPEBfX9+/DJhmMDKaZgBZxagBdDOAbjgwagDSzQDSzQDSzQDSzQAAz1014322VQQAAAAASUVORK5CYII=';
    icon = nativeImage.createFromDataURL(iconData);
  } else {
    // 画像が読み込めた場合、メニューバーに適したサイズ(高さ16px)にリサイズする
    icon = icon.resize({ height: 16 });
    // リサイズするとTemplate属性が失われることがあるため、明示的に設定する
    icon.setTemplateImage(true);
  }
  
  tray = new Tray(icon);
  const contextMenu = Menu.buildFromTemplate([
    { label: `TypeSpark v${app.getVersion()}`, enabled: false },
    { label: 'Preference', click: createPreferenceWindow },
    { label: 'Quit', click: () => app.quit() }
  ]);
  tray.setContextMenu(contextMenu);
  tray.setToolTip('TypeSpark');

  // キーボード入力の監視を開始
  uIOhook.on('keydown', (e) => {
    // ウィンドウが存在する場合のみレンダラーへ通知
    if (win && !win.isDestroyed()) {
      // マウス座標を取得 (設定で有効な場合のみ)
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

  // 設定画面からの変更を受け取り、メインウィンドウへ転送する
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

// アプリ終了時の処理
app.on('will-quit', () => {
  uIOhook.stop();
});
