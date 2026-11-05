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
        [
          '-O2', '-framework', 'CoreGraphics', '-framework', 'CoreFoundation',
          '-framework', 'ApplicationServices', '-framework', 'Carbon', src, '-o', out,
        ],
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
// 注意 1: System Events 的进程名可能是英文名(WeChat)而非本地化名(微信), 必须按 unix id (pid) 匹配
// 注意 2: 小程序窗口的 AX 名常与 CGWindow 标题不一致, 按名精确匹配会静默失败,
//         导致整个进程前置后聊天主窗盖在游戏窗上面 -> 改为按窗口位置+尺寸定位, 标题模糊匹配兜底
// 注意 3: 目标窗口已在其位置最前时直接跳过, 不做任何激活操作
const lastRaise = new Map<number, number>();
export async function raiseWindow(windowId: number, force = false): Promise<void> {
  if (!force && Date.now() - (lastRaise.get(windowId) ?? 0) < 3000) return;
  const wins = await listWindows();
  const idx = wins.findIndex(w => w.windowId === windowId);
  if (idx < 0) throw new Error(`窗口 ${windowId} 不存在或已关闭`);
  const win = wins[idx];
  // 列表按从前到后排序: 若有更靠前的窗口盖住游戏窗口中心点才需要前置
  const cx = win.x + win.w / 2;
  const cy = win.y + win.h / 2;
  const covered = wins
    .slice(0, idx)
    .some(
      w =>
        w.windowId !== windowId &&
        w.w > 50 &&
        w.h > 50 &&
        cx >= w.x &&
        cx <= w.x + w.w &&
        cy >= w.y &&
        cy <= w.y + w.h
    );
  if (!covered) {
    lastRaise.set(windowId, Date.now());
    return;
  }
  const titleEsc = win.title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const script = `tell application "System Events"
  set procs to first process whose unix id is ${win.pid}
  set frontmost of procs to true
  set bx to ${win.x}
  set byy to ${win.y}
  set bw to ${win.w}
  set bh to ${win.h}
  repeat with w in windows of procs
    try
      set p to position of w
      set s to size of w
      if (item 1 of p) > bx - 60 and (item 1 of p) < bx + 60 and (item 2 of p) > byy - 60 and (item 2 of p) < byy + 60 and (item 3 of s) > bw - 60 and (item 3 of s) < bw + 60 and (item 4 of s) > bh - 60 and (item 4 of s) < bh + 60 then
        perform action "AXRaise" of w
        return "raised"
      end if
    end try
  end repeat
  repeat with w in windows of procs
    try
      if name of w contains "${titleEsc}" then
        perform action "AXRaise" of w
        return "raised"
      end if
    end try
  end repeat
  return "notfound"
end tell`;
  // 不吞错误: 前置失败时让调用方报错, 避免 HID 事件打到别的窗口"看似成功实则无反应"
  const { stdout } = await run('osascript', ['-e', script], { timeout: 8000 });
  if (!stdout.includes('raised')) {
    throw new Error(`未能定位窗口 "${win.title}" (AX 中未找到位置/标题匹配的窗口), 已中止注入`);
  }
  lastRaise.set(windowId, Date.now());
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
  // silent: 手势期间断开物理鼠标与光标的关联, 结束后光标瞬移回原位 -> 用户几乎无感
  const { stdout } = await run(
    bin,
    ['drag', String(win.pid), s.x.toFixed(1), s.y.toFixed(1), e.x.toFixed(1), e.y.toFixed(1), '18', '30', 'silent'],
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
  // silent: 同 winDrag, 光标无感
  const { stdout } = await run(
    bin,
    ['click', String(win.pid), g.x.toFixed(1), g.y.toFixed(1), 'silent'],
    { timeout: 15000 }
  );
  return stdout.trim();
}
