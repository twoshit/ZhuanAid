// 鼠标拖拽 C 助手: 首次调用时用 clang 编译并缓存二进制, 之后直接执行
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);

let buildPromise: Promise<string> | null = null;

async function findSource(): Promise<string> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(process.cwd(), 'server', 'native', 'mouse_drag.c'),
    path.resolve(here, '..', 'native', 'mouse_drag.c'),
  ];
  for (const p of candidates) {
    try {
      await access(p);
      return p;
    } catch {}
  }
  throw new Error('未找到 mouse_drag.c 源文件');
}

export async function ensureMouseBinary(): Promise<string> {
  if (!buildPromise) {
    buildPromise = (async () => {
      const src = await findSource();
      const dir = path.join(process.cwd(), '.output', 'native');
      await mkdir(dir, { recursive: true });
      const out = path.join(dir, 'mouse_drag');
      await run('clang', ['-O2', '-framework', 'CoreGraphics', '-framework', 'CoreFoundation', src, '-o', out], {
        timeout: 60000,
      });
      return out;
    })().catch(e => {
      buildPromise = null;
      throw e;
    });
  }
  return buildPromise;
}

export interface DragParams {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  imageWidth: number;
  imageHeight: number;
}

export async function execMouseDrag(p: DragParams): Promise<string> {
  const bin = await ensureMouseBinary();
  const { stdout } = await run(bin, [p.startX, p.startY, p.endX, p.endY, p.imageWidth, p.imageHeight].map(String), {
    timeout: 15000,
  });
  return stdout.trim();
}
