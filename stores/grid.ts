import { defineStore } from 'pinia';
import toastFactory from '~/composables/toast';
import { BOARD_REGIONS } from '~/config';
import { useReplayStore } from '~/stores/replay';
import { useSettingStore } from '~/stores/setting';
import type { EffectiveMove, EliminateBlock } from '~/types/board';
import type { BoardRegion } from '~/types/misc';
import { Board } from '~/utils/Board';
import { BoardParser } from '~/utils/BoardParser';
import { detectBoardRegion } from '~/utils/boardDetect';
import { cropImage, gridIsValid, highlight } from '~/utils/helper';
import { searchSolution } from '~/utils/solver';

// 生成 14x10 的空棋盘
// Array.from({ length: 14 }).map((_, i) => Array.from({ length: 10 }).fill(0));

interface GridState {
  loading: boolean;
  phase: string;
  grid: number[][];
  path: number[];
  eliminating: boolean;
  autoRunning: boolean;
  isStop: boolean;
  step: number;
  // 最近一次加载时棋盘在图像中的归一化区域 (供自动操作坐标映射)
  boardRegion: BoardRegion | null;
  // 屏幕抓取模式下的截图像素尺寸; 手动上传时为 null
  captureImageSize: { width: number; height: number } | null;
}

export const useGridStore = defineStore('grid', {
  state: (): GridState => ({
    loading: false,
    phase: '',
    grid: [
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ],
    path: [],
    eliminating: false,
    autoRunning: false,
    isStop: false,
    step: 1,
    boardRegion: null,
    captureImageSize: null,
  }),
  getters: {
    // 棋盘行数
    rows(): number {
      return this.grid.length;
    },
    // 棋盘列数
    cols(): number {
      return this.grid[0].length;
    },

    // 棋盘是否已全部消除
    isSuccess(): boolean {
      return new Board(this.grid).isSuccess();
    },

    // 所有可消除的块
    eliminates(): EliminateBlock[] {
      const board = new Board(this.grid);
      return board.findAllEliminateBlock();
    },

    // 所有可进行消除的移动操作
    moves(): EffectiveMove[] {
      const board = new Board(this.grid);
      return board.findAllEffectiveMoves();
    },
  },
  actions: {
    // 加载棋盘; screenInfo 提供时表示来自屏幕抓取(截图像素尺寸), 用于自动操作的坐标映射
    async load(file: File, screenInfo?: { width: number; height: number }) {
      const toast = toastFactory();
      const settingStore = useSettingStore();

      // 优先自动检测棋盘位置(自适应任意分辨率/机型/棋盘位置), 失败则回退到所选归一化预设
      // 屏幕抓取为全屏图像, 游戏窗口占比小, 放宽最小面积比例
      let targetRegion = await detectBoardRegion(
        file,
        settingStore.rows,
        settingStore.cols,
        screenInfo ? { screenMode: true, minAreaRatio: 0.005 } : undefined
      );
      if (!targetRegion) {
        console.warn('自动检测棋盘失败, 回退到裁剪预设:', settingStore.model);
        targetRegion = BOARD_REGIONS.find(region => region.id === settingStore.model) ?? BOARD_REGIONS[0];
      }

      this.boardRegion = targetRegion;
      this.captureImageSize = screenInfo ?? null;

      this.phase = '';
      // 加载新棋盘时清空回放记录
      useReplayStore().reset();
      const parser = new BoardParser(status => {
        this.phase = status;
      });

      try {
        this.loading = true;
        this.grid = Array.from({ length: settingStore.rows }).map(
          () => Array.from({ length: settingStore.cols }).fill(0) as number[]
        );

        // 裁剪图片
        const boardAreaFile = await cropImage(file, targetRegion);
        const grid = await parser.parse(boardAreaFile, settingStore.rows, settingStore.cols);
        console.log('提取的棋盘数据为:', grid);
        if (gridIsValid(grid)) {
          toast.success('棋盘加载成功', '现在可以开始验证了');
          this.grid = grid;
        } else {
          toast.error('棋盘加载失败', '部分图标无法匹配，请确认素材库是否包含全部图标。');
        }
      } catch (error: any) {
        toast.error('棋盘加载失败', error.message);
      } finally {
        this.loading = false;
      }
    },

    // 抓取本机屏幕并识别棋盘 (复用上传识别管线)
    async captureScreen() {
      const toast = toastFactory();
      this.loading = true;
      this.phase = '正在抓取屏幕…';
      try {
        const res = await $fetch<{ base64: string; width: number; height: number }>('/api/screen/capture', {
          method: 'POST',
        });
        const bin = atob(res.base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const file = new File([bytes], 'screen-capture.png', { type: 'image/png' });
        await this.load(file, { width: res.width, height: res.height });
      } catch (error: any) {
        this.loading = false;
        this.phase = '';
        toast.error('屏幕抓取失败', error?.statusMessage ?? error?.message ?? String(error));
      }
    },

    // 执行【移动】操作: 整行/整列刚性平移, 真实游戏中表现为一次拖拽
    async execMove(move: EffectiveMove): Promise<void> {
      const settingStore = useSettingStore();

      return new Promise(async resolve => {
        // 拖拽向量: 从线段起点拖到平移后的位置 (AutoControl 依赖此做鼠标拖拽映射)
        const dragArea = {
          point1: move.tileVector.start,
          point2: {
            r: move.tileVector.start.r + move.direction.dr * move.distance,
            c: move.tileVector.start.c + move.direction.dc * move.distance,
          },
        };
        await highlight(dragArea, settingStore.autoPlayDuration);

        const prevGrid = this.grid.map(row => [...row]);
        const board = new Board(this.grid);
        const [grid, movedTileVector] = board.execMove(move);
        this.grid = grid;

        // 记录回放步骤 (回放模式进行中不记录, 避免污染回放数据)
        const replayStore = useReplayStore();
        if (!replayStore.active) {
          replayStore.record(
            {
              type: 'move',
              grid: grid.map(row => [...row]),
              area: dragArea,
              value: move.eliminate.value,
            },
            prevGrid
          );
        }

        setTimeout(async () => {
          await highlight(
            { point1: movedTileVector.start, point2: movedTileVector.end },
            settingStore.autoPlayDuration
          );
          resolve();
          this.step++;
        }, 0);
      });
    },

    // 执行【消除】操作
    async execEliminate(eliminate: EliminateBlock) {
      const settingStore = useSettingStore();

      await highlight(eliminate, settingStore.autoPlayDuration);

      const prevGrid = this.grid.map(row => [...row]);
      const board = new Board(this.grid);
      const grid = board.execEliminate(eliminate);
      if (grid) {
        this.grid = grid;

        // 记录回放步骤 (回放模式进行中不记录, 避免污染回放数据)
        const replayStore = useReplayStore();
        if (!replayStore.active) {
          replayStore.record(
            {
              type: 'eliminate',
              grid: grid.map(row => [...row]),
              area: { point1: eliminate.point1, point2: eliminate.point2 },
              value: eliminate.value,
            },
            prevGrid
          );
        }
      }
    },

    // 执行【全部消除】操作
    async execEliminateAll() {
      this.eliminating = true;

      while (true) {
        for (const eliminate of this.eliminates) {
          await this.execEliminate(eliminate);
        }

        if (this.eliminates.length === 0) {
          break;
        }
      }
      this.eliminating = false;
    },

    // 自动执行
    async magic() {
      const toast = toastFactory();
      this.autoRunning = true;

      // 先算后演: 在棋盘副本上按真实规则随机重启搜索(无动画、速度快),
      // 找到完整全解则演示全解; 否则演示最优部分解并如实报告剩余格数(真实规则下部分棋盘确实无法全消)。
      if (!this.isStop && !this.isSuccess) {
        this.phase = '正在计算最优解';
        const result = await searchSolution(this.grid, {
          shouldStop: () => this.isStop,
          onProgress: (attempt, bestRemain) => {
            this.phase = `正在计算最优解(已尝试 ${attempt} 次, 最优剩余 ${bestRemain} 格)`;
          },
        });
        this.phase = '';

        if (result) {
          for (const action of result.actions) {
            if (this.isStop) {
              break;
            }
            if (action.type === 'eliminate') {
              await this.execEliminate(action.block);
            } else {
              await this.execMove(action.move);
            }
          }
        }

        if (this.isSuccess) {
          console.log('成功');
          toast.success('执行结束', '已成功消除所有格子');
        } else if (!this.isStop && result) {
          console.warn(`演示最优路径结束, 剩余 ${result.remain} 格(当前规则下已无合法操作)`);
          toast.error('无法全消', `当前规则下最多只能消到剩 ${result.remain} 格, 已演示最优路径`);
        }
      }

      this.autoRunning = false;
      this.isStop = false;
    },

    stop() {
      this.isStop = true;
    },
  },
});
