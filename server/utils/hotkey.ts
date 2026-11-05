// 全局停止热键 (⌘⌥A): 常驻 `wininput hotkey` 子进程监听系统键盘事件,
// 命中后子进程打印 pressed 并退出, 这里记录触发时间戳供前端轮询。
// 状态挂在 globalThis 上以在 nitro 热重载之间保持。
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { ensureWinInputBinary } from './winInput';

interface HotkeyState {
  proc: ChildProcess | null;
  triggered: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __zhuanHotkey: HotkeyState | undefined;
}

function state(): HotkeyState {
  if (!globalThis.__zhuanHotkey) globalThis.__zhuanHotkey = { proc: null, triggered: 0 };
  return globalThis.__zhuanHotkey;
}

export async function armHotkey(): Promise<void> {
  const st = state();
  st.proc?.kill();
  const bin = await ensureWinInputBinary();
  const proc = spawn(bin, ['hotkey'], { stdio: ['ignore', 'pipe', 'pipe'] });
  st.proc = proc;
  proc.stdout?.on('data', d => {
    if (String(d).includes('pressed')) st.triggered = Date.now();
  });
  proc.on('exit', () => {
    if (st.proc === proc) st.proc = null;
  });
  proc.on('error', () => {
    if (st.proc === proc) st.proc = null;
  });
}

export function hotkeyStatus(): { armed: boolean; triggered: number } {
  const st = state();
  return { armed: !!st.proc, triggered: st.triggered };
}

export function resetHotkey(): void {
  state().triggered = 0;
}

export function disarmHotkey(): void {
  const st = state();
  st.proc?.kill();
  st.proc = null;
}
