import fs from 'node:fs';
import path from 'node:path';

const runtimeFileName = 'dailog-runtime.json';
const heartbeatIntervalMs = 3000;
const runtimeFreshMs = 9000;

function runtimeFilePath(userDataPath) {
  return path.join(userDataPath, runtimeFileName);
}
function writeRuntimeState(userDataPath) {
  fs.mkdirSync(userDataPath, { recursive: true });
  fs.writeFileSync(
    runtimeFilePath(userDataPath),
    JSON.stringify({
      pid: process.pid,
      updatedAt: Date.now(),
    }),
    'utf8',
  );
}

function removeRuntimeState(userDataPath) {
  const filePath = runtimeFilePath(userDataPath);
  try {
    const runtime = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (runtime?.pid !== process.pid) {
      return;
    }
  } catch {
    return;
  }

  try {
    fs.unlinkSync(filePath);
  } catch {
    // The heartbeat is only a lifecycle hint. Failing to remove it will expire naturally.
  }
}

export function startMainRuntimeHeartbeat(userDataPath) {
  writeRuntimeState(userDataPath);
  const timer = setInterval(() => writeRuntimeState(userDataPath), heartbeatIntervalMs);
  timer.unref?.();

  return () => {
    clearInterval(timer);
    removeRuntimeState(userDataPath);
  };
}

export function isMainRuntimeActive(userDataPath, maxAgeMs = runtimeFreshMs) {
  try {
    const runtime = JSON.parse(fs.readFileSync(runtimeFilePath(userDataPath), 'utf8'));
    const updatedAt = Number(runtime?.updatedAt || 0);
    return Date.now() - updatedAt <= maxAgeMs;
  } catch {
    return false;
  }
}
