// 调用系统 screencapture 抓取主显示器, 返回 PNG Buffer (临时文件读取后立即删除)
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const run = promisify(execFile);

export async function captureScreenPng(): Promise<Buffer> {
  const tmp = path.join(os.tmpdir(), `zhuanaid-capture-${randomUUID()}.png`);
  try {
    await run('screencapture', ['-x', tmp], { timeout: 15000 });
    return await readFile(tmp);
  } finally {
    await unlink(tmp).catch(() => {});
  }
}
