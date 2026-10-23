// 窗口级后台输入: wininput 助手编译 + 窗口列表/截图/拖拽/点击
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdir, readFile, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);

let buildPromise: Promise<string> | null = null;

async function findSource(): Promise<string> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(process.cwd(), 'server', 'native', 'wininput.c'),
    path.resolve(here, '..', 'native', 'wininput.c'),
  ];
  for (const p of candidates) {
    try {
      await access(p);
      return p;
    } catch {}
  }
  throw new Error('未找到 wininput.c 源文件');
}

export async function ensureWinInputBinary(): Promise<string> {
  if (!buildPromise) {
    buildPromise = (async () => {
      const src = await findSource();
      const dir = path.join(process.cwd(), '.output', 'native');
      await mkdir(dir, { recursive: true });
      const out = path.join(dir, 'wininput');
      await run(
        'clang',
        ['-O2', '-framework', 'CoreGraphics', '-framework', 'CoreFoundation', src, '-o', out],
        { timeout: 60000 }
      );
      return out;
    })().catch(e => {
      buildPromise = null;
      throw e;
    });
  }
  return buildPromise;
}

export interface WinInfo {
  windowId: number;
  pid: number;
  owner: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export async function listWindows(): Promise<WinInfo[]> {
  const bin = await ensureWinInputBinary();
  const { stdout } = await run(bin, ['list'], { timeout: 10000 });
  const out: WinInfo[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    const [id, pid, owner, title, bounds] = line.split('\t');
    const [x, y, w, h] = (bounds || '').split(' ').map(Number);
    if (!id || !pid) continue;
    out.push({
      windowId: Number(id),
      pid: Number(pid),
      owner: owner || '',
      title: title || '',
      x,
      y,
      w,
      h,
    });
  }
  return out;
}

export async function windowBounds(windowId: number): Promise<WinInfo> {
  const wins = await listWindows();
  const win = wins.find(w => w.windowId === windowId);
  if (!win) throw new Error(`窗口 ${windowId} 不存在或已关闭`);
  return win;
}

// 截取指定窗口(不需要前台/不被遮挡), 返回 base64 PNG 与像素尺寸
export async function captureWindow(
  windowId: number
): Promise<{ base64: string; width: number; height: number }> {
  const tmp = path.join(os.tmpdir(), `win-${windowId}-${Date.now()}.png`);
  try {
    await run('screencapture', ['-o', '-l', String(windowId), '-x', tmp], { timeout: 15000 });
    const buf = await readFile(tmp);
    if (buf.length < 24) throw new Error('窗口截图为空');
    return { base64: buf.toString('base64'), width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

// 注入前把目标窗口提到最前(HID 事件要求窗口为当前活动窗口, 真机验证)
export async function raiseWindow(windowId: number): Promise<void> {
  const wins = await listWindows();
  const win = wins.find(w => w.windowId === windowId);
  if (!win) throw new Error(`窗口 ${windowId} 不存在或已关闭`);
  const ownerEsc = win.owner.replace(/"/g, '\\"');
  // 无标题窗口退化为按位置匹配; 有标题按名称 AXRaise
  const script = win.title
    ? `tell application "System Events"
  set frontmost of process "${ownerEsc}" to true
  tell process "${ownerEsc}"
    repeat with w in windows
      if name of w is "${win.title.replace(/"/g, '\\"')}" then
        perform action "AXRaise" of w
        exit repeat
      end if
    end repeat
  end tell`
    : `tell application "System Events" to set frontmost of process "${ownerEsc}" to true`;
  await run('osascript', ['-e', script], { timeout: 8000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 250));
}

// 窗口截图像素坐标 -> 全局显示点坐标
export function pixelToGlobal(
  win: WinInfo,
  px: number,
  py: number,
  imageSize: { width: number; height: number }
): { x: number; y: number } {
  const scale = win.w / imageSize.width;
  return { x: win.x + px * scale, y: win.y + py * scale };
}

export async function winDrag(p: {
  windowId: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  imageWidth: number;
  imageHeight: number;
}): Promise<string> {
  const bin = await ensureWinInputBinary();
  await raiseWindow(p.windowId);
  const win = await windowBounds(p.windowId);
  const size = { width: p.imageWidth, height: p.imageHeight };
  const s = pixelToGlobal(win, p.startX, p.startY, size);
  const e = pixelToGlobal(win, p.endX, p.endY, size);
  const { stdout } = await run(
    bin,
    ['drag', String(win.pid), s.x.toFixed(1), s.y.toFixed(1), e.x.toFixed(1), e.y.toFixed(1)],
    { timeout: 15000 }
  );
  return stdout.trim();
}

export async function winClick(p: {
  windowId: number;
  x: number;
  y: number;
  imageWidth: number;
  imageHeight: number;
}): Promise<string> {
  const bin = await ensureWinInputBinary();
  await raiseWindow(p.windowId);
  const win = await windowBounds(p.windowId);
  const g = pixelToGlobal(win, p.x, p.y, { width: p.imageWidth, height: p.imageHeight });
  const { stdout } = await run(
    bin,
    ['click', String(win.pid), g.x.toFixed(1), g.y.toFixed(1)],
    { timeout: 15000 }
  );
  return stdout.trim();
}
