import { defineStore } from 'pinia';
import { useGridStore } from '~/stores/grid';
import { useReplayStore } from '~/stores/replay';
import type { Coordinate } from '~/types/board';

// 一次拖拽任务: 从 from 格拖到 to 格 (消除由游戏自动完成)
export interface DragTask {
  from: Coordinate;
  to: Coordinate;
  value: number;
}

interface AutoControlState {
  // step: 逐步确认; auto: 全自动
  mode: 'step' | 'auto';
  // 下一个待执行的拖拽任务下标
  queueIndex: number;
  // 全自动执行中
  running: boolean;
  // 单次拖拽执行中
  executing: boolean;
  // 全自动模式两次拖拽之间的间隔(ms), 留出游戏消除动画时间
  intervalMs: number;
  // 最近一次执行错误信息
  lastError: string;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export const useAutoControlStore = defineStore('autoControl', {
  state: (): AutoControlState => ({
    mode: 'step',
    queueIndex: 0,
    running: false,
    executing: false,
    intervalMs: 800,
    lastError: '',
  }),
  getters: {
    // 拖拽队列: 回放步骤中的 move 类型 (消除步骤无需操作)
    tasks(): DragTask[] {
      const replayStore = useReplayStore();
      return replayStore.steps
        .filter(s => s.type === 'move')
        .map(s => ({ from: s.area.point1, to: s.area.point2, value: s.value }));
    },
    // 仅在屏幕抓取模式(棋盘区域与截图尺寸已知)且存在拖拽任务时可用
    available(): boolean {
      const gridStore = useGridStore();
      return !!(gridStore.boardRegion && gridStore.captureImageSize) && this.tasks.length > 0;
    },
    nextTask(): DragTask | null {
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
    // 执行队列中的下一个拖拽, 成功返回 true
    async runNext(): Promise<boolean> {
      if (this.executing) return false;
      const task = this.nextTask;
      if (!task) return false;
      const gridStore = useGridStore();
      const size = gridStore.captureImageSize!;
      const start = this.cellToPixel(task.from);
      const end = this.cellToPixel(task.to);
      this.executing = true;
      this.lastError = '';
      try {
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
        this.queueIndex++;
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
