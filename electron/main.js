import { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, screen, shell, dialog } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { askModelQuestion, generateDailyReport, testModelConnection } from './aiClient.js';
import { createAppStateService } from './core/appStateService.js';
import { startMainRuntimeHeartbeat } from './core/runtimeGuard.js';
import { runMcpServer } from './mcpServer.js';
import { createStorage } from './storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isDev = !app.isPackaged;
const isMcpMode = process.env.DAILOG_MCP === '1' || process.argv.includes('--mcp') || app.commandLine.hasSwitch('mcp');
const devUrl = process.env.DAILOG_DEV_URL || 'http://localhost:5178';
const logoPath = path.join(__dirname, '..', 'logo.png');
const feedbackUrl = 'https://github.com/wangyuhao07/Dailog';

app.setName('Dailog');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu-sandbox');
if (process.env.DAILOG_USER_DATA_DIR) {
  app.setPath('userData', process.env.DAILOG_USER_DATA_DIR);
}
const floatingSize = { width: 416, height: 760 };
let floatingWindow = null;
let managerWindow = null;
let tray = null;
let isQuitting = false;
let resizeTimer = null;
let resizeState = null;
let appStateService = null;
let stateStorage = null;
let stateSyncTimer = null;
let lastStorageDataVersion = null;
let stopRuntimeHeartbeat = null;
const maxImportFileSize = 10 * 1024 * 1024;
const supportsAutoLaunch = process.platform === 'win32' || process.platform === 'darwin';

function broadcastState(nextState) {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.webContents.isDestroyed()) {
      win.webContents.send('state:changed', nextState);
    }
  });
}

function startExternalStateSync() {
  if (!stateStorage?.getDataVersion || stateSyncTimer) {
    return;
  }

  lastStorageDataVersion = stateStorage.getDataVersion();
  stateSyncTimer = setInterval(() => {
    if (!stateStorage || !appStateService) {
      return;
    }

    const nextDataVersion = stateStorage.getDataVersion();
    if (nextDataVersion === lastStorageDataVersion) {
      return;
    }

    lastStorageDataVersion = nextDataVersion;
    const nextState = appStateService.getState({ refresh: true });
    broadcastState(nextState);
  }, 750);
}

function stopExternalStateSync() {
  if (stateSyncTimer) {
    clearInterval(stateSyncTimer);
    stateSyncTimer = null;
  }
}

if (isMcpMode) {
  runMcpServer({ app, version: app.getVersion() }).catch((error) => {
    process.stderr.write(`Dailog MCP 启动失败：${error?.message || '未知错误'}\n`);
    app.exit(1);
  });
} else {
  const gotSingleInstanceLock = app.requestSingleInstanceLock();
  if (!gotSingleInstanceLock) {
    app.quit();
  }
}

function buildLoginItemSettings(openAtLogin) {
  const settings = {
    path: process.execPath,
    args: isDev ? [app.getAppPath(), '--autostart'] : ['--autostart'],
  };

  if (typeof openAtLogin === 'boolean') {
    settings.openAtLogin = openAtLogin;
  }

  return settings;
}

function getAutoLaunchEnabled() {
  if (!supportsAutoLaunch) {
    return false;
  }

  return Boolean(app.getLoginItemSettings(buildLoginItemSettings()).openAtLogin);
}

function setAutoLaunchEnabled(enabled) {
  if (!supportsAutoLaunch) {
    return false;
  }

  app.setLoginItemSettings(buildLoginItemSettings(Boolean(enabled)));
  return getAutoLaunchEnabled();
}

function stopFloatingResize() {
  if (resizeTimer) {
    clearInterval(resizeTimer);
    resizeTimer = null;
  }

  resizeState = null;
}

function loadRoute(win, route) {
  if (isDev) {
    win.loadURL(`${devUrl}#/${route}`);
    return;
  }

  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash: `/${route}` });
}

function createFloatingWindow() {
  if (floatingWindow) {
    floatingWindow.show();
    floatingWindow.focus();
    return;
  }

  floatingWindow = new BrowserWindow({
    width: floatingSize.width,
    height: floatingSize.height,
    minWidth: floatingSize.width,
    minHeight: floatingSize.height,
    frame: false,
    title: 'Dailog',
    icon: logoPath,
    backgroundColor: '#00000000',
    transparent: true,
    resizable: true,
    alwaysOnTop: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  loadRoute(floatingWindow, 'floating');
  floatingWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      floatingWindow.hide();
    }
  });
  floatingWindow.on('closed', () => {
    stopFloatingResize();
    floatingWindow = null;
  });
}

function showFloatingWindow() {
  if (floatingWindow) {
    floatingWindow.show();
    floatingWindow.focus();
    return;
  }

  createFloatingWindow();
}

ipcMain.handle('floating:close', () => {
  if (floatingWindow) {
    floatingWindow.hide();
  }
});

ipcMain.handle('floating:start-resize', () => {
  if (!floatingWindow) {
    return;
  }

  stopFloatingResize();

  const startBounds = floatingWindow.getBounds();
  const startPoint = screen.getCursorScreenPoint();
  resizeState = {
    windowId: floatingWindow.id,
    startBounds,
    startPoint,
  };

  resizeTimer = setInterval(() => {
    if (!floatingWindow || !resizeState || floatingWindow.id !== resizeState.windowId) {
      stopFloatingResize();
      return;
    }

    const point = screen.getCursorScreenPoint();
    const nextWidth = Math.max(floatingSize.width, resizeState.startBounds.width + (point.x - resizeState.startPoint.x));
    const nextHeight = Math.max(floatingSize.height, resizeState.startBounds.height + (point.y - resizeState.startPoint.y));

    floatingWindow.setBounds({
      x: resizeState.startBounds.x,
      y: resizeState.startBounds.y,
      width: nextWidth,
      height: nextHeight,
    });
  }, 16);
});

ipcMain.handle('floating:end-resize', () => {
  stopFloatingResize();
});

ipcMain.handle('state:get', () => {
  return appStateService?.getState() ?? null;
});

ipcMain.handle('state:set', (event, nextState) => {
  return appStateService?.setState(nextState, { sourceWebContentsId: event.sender.id }) ?? null;
});

ipcMain.handle('shell:open-external', (_event, url) => {
  if (url !== feedbackUrl) {
    return false;
  }

  shell.openExternal(url);
  return true;
});

ipcMain.handle('app:get-auto-launch', () => ({
  ok: true,
  supported: supportsAutoLaunch,
  enabled: getAutoLaunchEnabled(),
}));

ipcMain.handle('app:set-auto-launch', (_event, enabled) => {
  try {
    return {
      ok: true,
      supported: supportsAutoLaunch,
      enabled: setAutoLaunchEnabled(enabled),
    };
  } catch (error) {
    return {
      ok: false,
      supported: supportsAutoLaunch,
      enabled: getAutoLaunchEnabled(),
      message: error?.message || 'Failed to update auto launch setting.',
    };
  }
});

ipcMain.handle('app:get-mcp-client-config', () => ({
  ok: true,
  config: {
    mcpServers: {
      dailog: {
        command: isDev ? path.join(app.getAppPath(), 'node_modules', 'electron', 'dist', 'electron.exe') : process.execPath,
        args: [
          isDev
            ? path.join(app.getAppPath(), 'electron', 'mcpNodeServer.js')
            : path.join(process.resourcesPath, 'app.asar', 'electron', 'mcpNodeServer.js'),
        ],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
        },
      },
    },
  },
}));

ipcMain.handle('ai:test-model', (_event, config) => testModelConnection(config));
ipcMain.handle('ai:ask-model', (_event, config, question) => askModelQuestion(config, question));
ipcMain.handle('ai:generate-daily-report', (_event, config, prompt) => generateDailyReport(config, prompt));

function exportFileName(exportType) {
  const date = new Date().toISOString().slice(0, 10);
  return `dailog-${exportType}-${date}.json`;
}

function showOpenJsonDialog(owner, options) {
  return owner ? dialog.showOpenDialog(owner, options) : dialog.showOpenDialog(options);
}

ipcMain.handle('data:export', async (event, exportType, payload) => {
  const safeType = exportType === 'full' ? 'full' : 'records';
  const owner = BrowserWindow.fromWebContents(event.sender);
  const result = await showOpenJsonDialog(owner, {
    title: safeType === 'full' ? '导出全部数据' : '导出记录数据',
    defaultPath: app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory'],
  });

  if (result.canceled || !result.filePaths?.[0]) {
    return { ok: false, canceled: true, message: '已取消导出。' };
  }

  const filePath = path.join(result.filePaths[0], exportFileName(safeType));
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return { ok: true, filePath, message: '导出完成。' };
});

ipcMain.handle('data:import', async (event) => {
  const owner = BrowserWindow.fromWebContents(event.sender);
  const result = await showOpenJsonDialog(owner, {
    title: '导入 Dailog JSON 数据',
    properties: ['openFile'],
    filters: [{ name: 'JSON 文件', extensions: ['json'] }],
  });

  if (result.canceled || !result.filePaths?.[0]) {
    return { ok: false, canceled: true, message: '已取消导入。' };
  }

  const filePath = result.filePaths[0];
  const stat = await fs.stat(filePath);
  if (stat.size > maxImportFileSize) {
    return { ok: false, message: '导入失败：文件超过 10MB，请确认是否为 Dailog 导出文件。' };
  }

  try {
    const text = await fs.readFile(filePath, 'utf8');
    return { ok: true, filePath, payload: JSON.parse(text) };
  } catch {
    return { ok: false, message: '导入失败：JSON 文件格式不正确。' };
  }
});

function createManagerWindow() {
  if (managerWindow) {
    managerWindow.focus();
    return;
  }

  managerWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    title: 'Dailog 管理页',
    icon: logoPath,
    backgroundColor: '#f5f5f5',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  loadRoute(managerWindow, 'manager');
  managerWindow.on('closed', () => {
    managerWindow = null;
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(logoPath);
  tray = new Tray(icon);
  tray.setToolTip('Dailog');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '打开控制台',
        click: () => createManagerWindow(),
      },
      {
        label: '显示悬浮窗',
        click: () => showFloatingWindow(),
      },
      {
        type: 'separator',
      },
      {
        label: '退出 Dailog',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('double-click', () => createFloatingWindow());
}

if (!isMcpMode) {
  app.on('second-instance', () => {
    showFloatingWindow();
    if (managerWindow) {
      managerWindow.show();
      managerWindow.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    stateStorage = createStorage(app.getPath('userData'));
    appStateService = createAppStateService({
      storage: stateStorage,
      onChange(nextState, options = {}) {
        lastStorageDataVersion = stateStorage?.getDataVersion?.() ?? lastStorageDataVersion;
        BrowserWindow.getAllWindows().forEach((win) => {
          if (win.webContents.id !== options.sourceWebContentsId && !win.webContents.isDestroyed()) {
            win.webContents.send('state:changed', nextState);
          }
        });
      },
    });
    startExternalStateSync();
    stopRuntimeHeartbeat = startMainRuntimeHeartbeat(app.getPath('userData'));
    createTray();
    showFloatingWindow();

    app.on('activate', () => {
      if (floatingWindow) {
        floatingWindow.show();
        floatingWindow.focus();
        return;
      }

      showFloatingWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (isQuitting && process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    stopExternalStateSync();
    stopRuntimeHeartbeat?.();
    appStateService?.close();
    stateStorage = null;
  });
}
