import { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, screen, shell, dialog } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { askModelQuestion, generateDailyReport, testModelConnection } from './aiClient.js';
import { createStorage } from './storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isDev = !app.isPackaged;
const devUrl = process.env.DAILOG_DEV_URL || 'http://localhost:5178';
const logoPath = path.join(__dirname, '..', 'logo.png');
const feedbackUrl = 'https://github.com/wangyuhao07/Dailog';

app.setName('Dailog');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu-sandbox');
const floatingSize = { width: 416, height: 760 };
let floatingWindow = null;
let managerWindow = null;
let tray = null;
let isQuitting = false;
let resizeTimer = null;
let resizeState = null;
let storage = null;
let sharedAppState = null;
const maxImportFileSize = 10 * 1024 * 1024;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
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
  if (!storage) {
    return sharedAppState;
  }

  sharedAppState = storage.readState();
  return sharedAppState;
});

ipcMain.handle('state:set', (event, nextState) => {
  sharedAppState = storage ? storage.writeState(nextState) : nextState;

  BrowserWindow.getAllWindows().forEach((win) => {
    if (win.webContents.id !== event.sender.id && !win.webContents.isDestroyed()) {
      win.webContents.send('state:changed', sharedAppState);
    }
  });

  return sharedAppState;
});

ipcMain.handle('shell:open-external', (_event, url) => {
  if (url !== feedbackUrl) {
    return false;
  }

  shell.openExternal(url);
  return true;
});

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

app.on('second-instance', () => {
  showFloatingWindow();
  if (managerWindow) {
    managerWindow.show();
    managerWindow.focus();
  }
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  storage = createStorage(app.getPath('userData'));
  sharedAppState = storage.readState();
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
  storage?.close();
});
