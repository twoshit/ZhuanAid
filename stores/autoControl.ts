import { defineStore } from 'pinia';
import { useGridStore } from '~/stores/grid';
import { useReplayStore } from '~/stores/replay';
import { cropImage } from '~/utils/helper';
import { BoardParser } from '~/utils/BoardParser';
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
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
    windowMode(): boolean {
      const gridStore = useGridStore();
      return this.inputMode === 'window' && !!gridStore.windowTarget;
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
          await sleep(150);
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
      return gridsEqual(parsed, expectedGrid);
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
            await sleep(this.intervalMs);
            const ok = await this.verifyStep(expected).catch(() => false);
            if (!ok) {
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
      while (this.running && this.queueIndex < this.tasks.length) {
        const ok = await this.runNext();
        if (!ok) break;
        let waited = 0;
        while (this.running && waited < this.intervalMs) {
          await sleep(100);
          waited += 100;
        }
      }
      this.running = false;
    },
    stop() {
      this.running = false;
    },
  },
});
