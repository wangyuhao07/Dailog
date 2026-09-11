import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const host = '127.0.0.1';
const portRanges = [
  [5178, 5178],
  [6060, 6089],
];
const tempUserData = path.join(process.env.TEMP || process.env.TMP || root, 'Dailog-electron-user-data');
const viteCli = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const electronExe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isRendererReady(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

async function findDevPort() {
  for (const [startPort, endPort] of portRanges) {
    for (let port = startPort; port <= endPort; port += 1) {
      const url = `http://${host}:${port}`;
      try {
        const response = await fetch(url);
        if (response.ok) {
          return { port, url, existing: true };
        }
      } catch {
        // No HTTP service is available here; check whether Vite can bind it.
      }

      if (await canListen(port)) {
        return { port, url, existing: false };
      }
    }
  }

  return null;
}

async function waitForRenderer(url) {
  for (let index = 0; index < 30; index += 1) {
    if (await isRendererReady(url)) {
      return true;
    }
    await sleep(500);
  }
  return false;
}

let renderer = null;
const devTarget = await findDevPort();

if (!devTarget) {
  console.error('[Dailog] 5178 和 6060-6089 都无法启动前端服务，请检查端口占用或系统网络权限。');
  process.exit(1);
}

const portUrl = devTarget.url;

if (devTarget.existing) {
  console.log(`[Dailog] 检测到 ${devTarget.port} 端口已有前端服务，直接打开 Electron。`);
} else {
  console.log(`[Dailog] 启动前端服务：${portUrl}`);
  renderer = spawn(process.execPath, [viteCli, '--host', host, '--port', String(devTarget.port), '--strictPort'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, BROWSER: 'none' },
  });

  const ready = await waitForRenderer(portUrl);
  if (!ready) {
    console.error('[Dailog] 前端服务启动超时。');
    renderer.kill();
    process.exit(1);
  }
}

console.log('[Dailog] 打开桌面窗口。');
const electron = spawn(electronExe, ['.'], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    DAILOG_DEV_URL: portUrl,
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    TEMP: path.dirname(tempUserData),
    TMP: path.dirname(tempUserData),
  },
});

electron.on('exit', (code) => {
  if (renderer) {
    renderer.kill();
  }
  process.exit(code ?? 0);
});
