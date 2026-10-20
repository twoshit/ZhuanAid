import { defineStore } from 'pinia';
import type { ReplayStep } from '~/types/board';
import { highlight } from '~/utils/helper';

interface ReplayState {
  // 已记录的步骤
  steps: ReplayStep[];
  // 第一步执行前的初始棋盘
  initialGrid: number[][];
  // 当前回放到的步骤下标, -1 表示初始状态
  currentIndex: number;
  // 是否处于回放模式
  active: boolean;
  // 是否正在自动播放
  playing: boolean;
}

let playTimer: ReturnType<typeof setTimeout> | null = null;

export const useReplayStore = defineStore('replay', {
  state: (): ReplayState => ({
    steps: [],
    initialGrid: [],
    currentIndex: -1,
    active: false,
    playing: false,
  }),
  getters: {
    // 是否有可回放的步骤
    canReplay(): boolean {
      return this.steps.length > 0;
    },
    // 回放模式下展示的棋盘快照, 非回放模式返回 null
    currentGrid(): number[][] | null {
      if (!this.active) return null;
      if (this.currentIndex < 0) return this.initialGrid.length ? this.initialGrid : null;
      return this.steps[this.currentIndex].grid;
    },
  },
  actions: {
    // 记录一步操作 (prevGrid 为该步骤执行前的棋盘)
    record(step: ReplayStep, prevGrid: number[][]) {
      if (this.steps.length === 0) {
        this.initialGrid = prevGrid.map(row => [...row]);
      }
      this.steps.push(step);
    },
    // 清空回放数据
    reset() {
      this.stopTimer();
      this.steps = [];
      this.initialGrid = [];
      this.currentIndex = -1;
      this.active = false;
      this.playing = false;
    },
    enter() {
      this.active = true;
      this.currentIndex = -1;
    },
    exit() {
      this.stopTimer();
      this.playing = false;
      this.active = false;
      this.currentIndex = -1;
    },
    play(interval = 800) {
      if (!this.canReplay) return;
      if (!this.active) this.enter();
      // 已播放到结尾时, 从头开始
      if (this.currentIndex >= this.steps.length - 1) {
        this.currentIndex = -1;
      }
      this.playing = true;
      this.scheduleNext(interval);
    },
    pause() {
      this.playing = false;
      this.stopTimer();
    },
    next(interval = 800) {
      if (this.currentIndex >= this.steps.length - 1) return;
      this.currentIndex++;
      const step = this.steps[this.currentIndex];
      highlight(step.area, interval);
    },
    prev() {
      if (this.currentIndex < 0) return;
      this.currentIndex--;
    },
    // 跳转到指定步骤 (列表点击)
    jumpTo(index: number) {
      this.pause();
      if (!this.active) this.enter();
      this.currentIndex = Math.min(Math.max(index, -1), this.steps.length - 1);
      const step = this.steps[this.currentIndex];
      if (step) highlight(step.area, 600);
    },
    scheduleNext(interval: number) {
      this.stopTimer();
      playTimer = setTimeout(() => {
        if (!this.playing) return;
        if (this.currentIndex >= this.steps.length - 1) {
          this.playing = false;
          return;
        }
        this.next(interval);
        this.scheduleNext(interval);
      }, interval);
    },
    stopTimer() {
      if (playTimer) {
        clearTimeout(playTimer);
        playTimer = null;
      }
    },
  },
});
