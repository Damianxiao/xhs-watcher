import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

export function acquireLock(path) {
  if (existsSync(path)) {
    let prev = null;
    try {
      prev = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      prev = null;
    }
    if (prev && isPidAlive(prev.pid)) {
      return { acquired: false, reason: 'already_running', holder: prev };
    }
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }, null, 2),
    'utf8',
  );
  return { acquired: true };
}

export function releaseLock(path) {
  if (existsSync(path)) unlinkSync(path);
}
