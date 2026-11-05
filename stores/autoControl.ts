import { defineStore } from 'pinia';
import { useGridStore } from '~/stores/grid';
import { useReplayStore } from '~/stores/replay';
import { cropImage } from '~/utils/helper';
import { BoardParser } from '~/utils/BoardParser';
import { Board } from '~/utils/Board';
import { searchSolution } from '~/utils/solver';
import type { Coordinate } from '~/types/board';

// 一次待执行的真实操作 (与回放步骤一一对应)
export type StepTask =
  // 移动消除: 从 from 格拖到 to 格
  | { type: 'move'; from: Coordinate; to: Coordinate; value: number }
  // 立即消除: 依次点击 p1 与 p2 两块可见同色砖
  | { type: 'eliminate'; p1: Coordinate; p2: Coordinate; value: number };

interface AutoControlState {
  // step: 逐步确认; auto: 全自动
  mode: 'step' | 'auto';
  // hid: 真实鼠标(占用光标, 窗口需前台); window: 后台注入(不占用鼠标)
  inputMode: 'hid' | 'window';
  // 每步执行后重新抓取窗口识别, 与预期棋盘比对, 不一致自动暂停
  syncVerify: boolean;
  // 下一个待执行任务下标
  queueIndex: number;
  // 全自动执行中
  running: boolean;
  // 单次任务执行中
  executing: boolean;
  // 全自动模式两次操作之间的间隔(ms), 留出游戏消除动画时间
  intervalMs: number;
  // 最近一次执行错误信息
  lastError: string;
  // 画面与预期不符时: 自动重抓识别+重新求解并继续 (仅全自动模式生效)
  autoRecover: boolean;
  // 恢复进行中 (阻止 steps watcher 打断当前运行)
  recovering: boolean;
  // 本轮全自动执行中已恢复次数 (防弹窗等导致的死循环)
  recoverCount: number;
  // 最近一次校验时抓取到的实际棋盘 (供恢复时直接复用, 省一次抓取)
  lastParsedGrid: number[][] | null;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 查询全局停止热键 (⌘⌥A) 是否被按下 (仅窗口模式在服务端有监听进程)
async function hotkeyHit(): Promise<boolean> {
  try {
    const st = await $fetch<{ armed: boolean; triggered: number }>('/api/hotkey/status');
    return st.triggered > 0;
  } catch {
    return false;
  }
}

function gridsEqual(a: number[][], b: number[][]): boolean {
  for (let r = 0; r < a.length; r++) {
    for (let c = 0; c < a[0].length; c++) {
      if (a[r][c] !== b[r][c]) return false;
    }
  }
  return true;
}

export const useAutoControlStore = defineStore('autoControl', {
  state: (): AutoControlState => ({
    mode: 'step',
    inputMode: 'window',
    syncVerify: true,
    queueIndex: 0,
    running: false,
    executing: false,
    intervalMs: 800,
    lastError: '',
    autoRecover: true,
    recovering: false,
    recoverCount: 0,
    lastParsedGrid: null,
  }),
  getters: {
    // 任务队列: 与回放步骤一一对应 (move=拖拽, eliminate=两次点击)
    tasks(): StepTask[] {
      const replayStore = useReplayStore();
      return replayStore.steps.map(s =>
        s.type === 'move'
          ? { type: 'move', from: s.area.point1, to: s.area.point2, value: s.value }
          : { type: 'eliminate', p1: s.area.point1, p2: s.area.point2, value: s.value }
      );
    },
    // 需已完成屏幕/窗口抓取(棋盘区域与截图尺寸已知)且存在步骤
    available(): boolean {
      const gridStore = useGridStore();
      return !!(gridStore.boardRegion && gridStore.captureImageSize) && this.tasks.length > 0;
    },
    // 窗口后台模式是否可用 (不占用鼠标)
    // 仅当棋盘来自"窗口抓取"时坐标才在窗口像素空间, 才能走窗口通道;
    // 整屏抓取的坐标必须走真实鼠标(HID)通道, 否则坐标系错位导致点击位置不对
    windowMode(): boolean {
      const gridStore = useGridStore();
      return this.inputMode === 'window' && !!gridStore.windowTarget && gridStore.captureSource === 'window';
    },
    nextTask(): StepTask | null {
      return this.queueIndex < this.tasks.length ? this.tasks[this.queueIndex] : null;
    },
    finished(): boolean {
      return this.tasks.length > 0 && this.queueIndex >= this.tasks.length;
    },
  },
  actions: {
    reset() {
      this.stop();
      this.queueIndex = 0;
      this.lastError = '';
      this.recoverCount = 0;
      this.lastParsedGrid = null;
    },
    // 格子坐标 -> 截图像素坐标 (格子中心)
    cellToPixel(p: Coordinate): { x: number; y: number } {
      const gridStore = useGridStore();
      const region = gridStore.boardRegion!;
      const size = gridStore.captureImageSize!;
      const x = (region.x1 + ((p.c + 0.5) / gridStore.cols) * (region.x2 - region.x1)) * size.width;
      const y = (region.y1 + ((p.r + 0.5) / gridStore.rows) * (region.y2 - region.y1)) * size.height;
      return { x, y };
    },
    // 执行一个任务 (拖拽或双点), 按 inputMode 走 HID 或窗口后台通道
    async execTask(task: StepTask): Promise<void> {
      const gridStore = useGridStore();
      const size = gridStore.captureImageSize!;
      if (!this.windowMode) {
        // HID 通道事件打给当前前台窗口: 先把游戏窗口提到最前
        // (未选窗口时服务端按标题自动查找《砖了个砖》; 找不到则维持现状, 由用户手动前置)
        await $fetch('/api/win/raise', {
          method: 'POST',
          body: { windowId: gridStore.windowTarget ?? undefined },
        }).catch(() => {});
      }
      if (task.type === 'move') {
        const start = this.cellToPixel(task.from);
        const end = this.cellToPixel(task.to);
        if (this.windowMode) {
          await $fetch('/api/win/drag', {
            method: 'POST',
            body: {
              windowId: gridStore.windowTarget!,
              startX: start.x,
              startY: start.y,
              endX: end.x,
              endY: end.y,
              imageWidth: size.width,
              imageHeight: size.height,
            },
          });
        } else {
          await $fetch('/api/mouse/drag', {
            method: 'POST',
            body: {
              startX: start.x,
              startY: start.y,
              endX: end.x,
              endY: end.y,
              imageWidth: size.width,
              imageHeight: size.height,
            },
          });
        }
      } else {
        const a = this.cellToPixel(task.p1);
        const b = this.cellToPixel(task.p2);
        if (this.windowMode) {
          await $fetch('/api/win/click', {
            method: 'POST',
            body: { windowId: gridStore.windowTarget!, x: a.x, y: a.y, imageWidth: size.width, imageHeight: size.height },
          });
          // 游戏需要时间渲染选中态, 过快第二击会被忽略
          await sleep(450);
          await $fetch('/api/win/click', {
            method: 'POST',
            body: { windowId: gridStore.windowTarget!, x: b.x, y: b.y, imageWidth: size.width, imageHeight: size.height },
          });
        } else {
          // HID 模式点击 = 起点终点重合的"零距拖拽"
          for (const p of [a, b]) {
            await $fetch('/api/mouse/drag', {
              method: 'POST',
              body: {
                startX: p.x,
                startY: p.y,
                endX: p.x,
                endY: p.y,
                imageWidth: size.width,
                imageHeight: size.height,
              },
            });
            await sleep(150);
          }
        }
      }
    },
    // 重新抓取窗口并识别, 与回放步骤的期望快照比对
    async verifyStep(expectedGrid: number[][]): Promise<boolean> {
      const gridStore = useGridStore();
      const res = await $fetch<{ base64: string; width: number; height: number }>('/api/win/capture', {
        method: 'POST',
        body: { windowId: gridStore.windowTarget! },
      });
      const bin = atob(res.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const file = new File([bytes], 'verify.png', { type: 'image/png' });
      const cropped = await cropImage(file, gridStore.boardRegion!);
      const parsed = await new BoardParser().parse(cropped, gridStore.rows, gridStore.cols);
      this.lastParsedGrid = parsed;
      const ok = gridsEqual(parsed, expectedGrid);
      if (!ok) {
        const diffs: string[] = [];
        for (let r = 0; r < parsed.length; r++)
          for (let c = 0; c < parsed[0].length; c++)
            if (parsed[r][c] !== expectedGrid[r][c]) diffs.push(`R${r + 1}C${c + 1} 实际${parsed[r][c]} 期望${expectedGrid[r][c]}`);
        console.warn('[SYNC-DIFF]', diffs.length, diffs.slice(0, 12).join(' | '));
      }
      return ok;
    },
    // 画面与预期不符时的自动恢复: 以最近一次校验抓取到的实际棋盘重新求解,
    // 重建回放队列(步骤快照即实际棋盘推演结果), 从新队列第 0 步继续执行。
    async resync(): Promise<boolean> {
      const actual = this.lastParsedGrid;
      if (!actual) return false;
      this.recovering = true;
      try {
        const gridStore = useGridStore();
        // 自动恢复场景保持小预算: 卡死局面重求解要快速给出可继续的部分解, 不等满盘穷搜
        const result = await searchSolution(actual, { maxPlayouts: 3000, budgetMs: 25000 });
        if (!result || result.actions.length === 0) return false;
        const replayStore = useReplayStore();
        replayStore.reset();
        let grid = actual.map(row => [...row]);
        for (const action of result.actions) {
          const board = new Board(grid);
          if (action.type === 'move') {
            const move = action.move;
            const area = {
              point1: move.tileVector.start,
              point2: {
                r: move.tileVector.start.r + move.direction.dr * move.distance,
                c: move.tileVector.start.c + move.direction.dc * move.distance,
              },
            };
            const [ng] = board.execMove(move);
            replayStore.record({ type: 'move', grid: ng, area, value: move.eliminate.value }, grid);
            grid = ng;
          } else {
            const el = action.block;
            const ng = board.execEliminate(el);
            if (!ng) break;
            replayStore.record(
              { type: 'eliminate', grid: ng, area: { point1: el.point1, point2: el.point2 }, value: el.value },
              grid
            );
            grid = ng;
          }
        }
        if (replayStore.steps.length === 0) return false;
        this.queueIndex = 0;
        gridStore.grid = actual.map(row => [...row]); // 网页实时棋盘跟随实际局面
        this.lastError = `画面不符, 已按实际棋盘重新求解 (${replayStore.steps.length} 步) 并继续`;
        return true;
      } finally {
        // 延迟到 steps watcher (微任务) 冲刷之后再清除标记, 避免重建触发的 watcher 把队列 reset
        setTimeout(() => {
          this.recovering = false;
        }, 0);
      }
    },
    // 执行队列中的下一个任务; 窗口同步模式下执行后校验一致性
    async runNext(): Promise<boolean> {
      if (this.executing) return false;
      const task = this.nextTask;
      if (!task) return false;
      const replayStore = useReplayStore();
      this.executing = true;
      this.lastError = '';
      try {
        await this.execTask(task);
        this.queueIndex++;
        if (this.syncVerify && this.windowMode) {
          const expected = replayStore.steps[this.queueIndex - 1]?.grid;
          if (expected) {
            // 自适应等待游戏动画播完: 校验不符则间隔重验, 与速度档位(intervalMs)解耦。
            // 拖拽+消除动画约 2~3s, 固定短等待会在动画中途截图导致误报。
            let ok = false;
            let stopped = false;
            // 首查时机贴近动画结束点: 过早会白跑一次完整识别(~2s), 过晚纯等
            await sleep(task.type === 'move' ? 1100 : 500);
            for (let attempt = 0; attempt < 6 && !ok; attempt++) {
              ok = await this.verifyStep(expected).catch(() => false);
              if (!ok) {
                // 校验等待期间也要响应全局停止热键
                if (await hotkeyHit()) {
                  stopped = true;
                  break;
                }
                await sleep(500);
              }
            }
            if (stopped) {
              this.queueIndex--; // 该步未确认成功, 允许重试
              this.lastError = '已通过全局快捷键 ⌘⌥A 停止';
              return false;
            }
            if (!ok) {
              // 自动恢复: 以实际棋盘重新求解并继续 (仅全自动模式, 单轮最多 3 次)
              if (this.autoRecover && this.running && this.recoverCount < 3) {
                const recovered = await this.resync().catch(() => false);
                if (recovered) {
                  this.recoverCount++;
                  console.warn('[RECOVER] 已按实际棋盘重新求解并继续, 第', this.recoverCount, '次');
                  return true;
                }
              }
              this.queueIndex--; // 该步未确认成功, 允许重试
              throw new Error('窗口画面与预期不符 (可能有弹窗/动画未结束/操作未被接受), 已暂停');
            }
          }
        }
        return true;
      } catch (err: any) {
        this.lastError = err?.statusMessage ?? err?.message ?? String(err);
        return false;
      } finally {
        this.executing = false;
      }
    },
    // 全自动执行剩余队列
    async runAll() {
      if (this.running) return;
      this.running = true;
      // 任意输入模式都武装全局停止热键 ⌘⌥A (监听进程与输入通道无关)
      const hk = true;
      if (hk) {
        try {
          await $fetch('/api/hotkey/reset', { method: 'POST' });
          await $fetch('/api/hotkey/arm', { method: 'POST' });
        } catch {
          /* 热键武装失败不阻断执行 */
        }
      }
      while (this.running && this.queueIndex < this.tasks.length) {
        const ok = await this.runNext();
        if (!ok) break;
        let waited = 0;
        while (this.running && waited < this.intervalMs) {
          await sleep(100);
          waited += 100;
          if (hk && waited % 300 === 0 && (await hotkeyHit())) {
            this.running = false;
            this.lastError = '已通过全局快捷键 ⌘A 停止';
            break;
          }
        }
      }
      this.running = false;
      if (hk) $fetch('/api/hotkey/disarm', { method: 'POST' }).catch(() => {});
    },
    stop() {
      this.running = false;
    },
  },
});
