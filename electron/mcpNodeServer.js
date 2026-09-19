import fs from 'node:fs';
import path from 'node:path';
import { isMainRuntimeActive } from './core/runtimeGuard.js';
import { createStorage } from './storage.js';
import { isMcpEnabled, startMcpServer } from './mcpServer.js';

const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

function defaultUserDataPath() {
  if (process.env.DAILOG_USER_DATA_DIR) {
    return process.env.DAILOG_USER_DATA_DIR;
  }

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
    return path.join(appData, 'Dailog');
  }

  if (process.platform === 'darwin') {
    return path.join(process.env.HOME || '', 'Library', 'Application Support', 'Dailog');
  }

  return path.join(process.env.XDG_CONFIG_HOME || path.join(process.env.HOME || '', '.config'), 'Dailog');
}

const userDataPath = defaultUserDataPath();

if (!isMainRuntimeActive(userDataPath)) {
  fs.writeSync(2, 'Dailog 主程序未运行。请先启动 Dailog，再使用本地 MCP。\n');
  process.exit(0);
}

const storage = createStorage(userDataPath);

if (!isMcpEnabled(storage)) {
  storage.close();
  fs.writeSync(2, 'Dailog MCP 未启用。请在 Dailog 设置页开启“允许本地 MCP 访问 Dailog 数据”。\n');
  process.exit(0);
}

const runtimeWatchTimer = setInterval(() => {
  if (!isMainRuntimeActive(userDataPath) || !isMcpEnabled(storage)) {
    storage.close();
    process.exit(0);
  }
}, 2000);
runtimeWatchTimer.unref?.();

startMcpServer({
  storage,
  version: packageJson.version,
  canAccess: () => isMainRuntimeActive(userDataPath) && isMcpEnabled(storage),
  onClose: () => {
    clearInterval(runtimeWatchTimer);
    process.exit(0);
  },
});
