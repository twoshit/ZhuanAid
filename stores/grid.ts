import { defineStore } from 'pinia';
import toastFactory from '~/composables/toast';
import { BOARD_REGIONS } from '~/config';
import { useReplayStore } from '~/stores/replay';
import { useSettingStore } from '~/stores/setting';
import type { EffectiveMove, EliminateBlock } from '~/types/board';
import { Board } from '~/utils/Board';
import { BoardParser } from '~/utils/BoardParser';
import { detectBoardRegion } from '~/utils/boardDetect';
import { cropImage, gridIsValid, highlight } from '~/utils/helper';

// 生成 14x10 的空棋盘
// Array.from({ length: 14 }).map((_, i) => Array.from({ length: 10 }).fill(0));

interface GridState {
  loading: boolean;
  phase: string;
  grid: number[][];
  backupGrid: number[][];
  path: number[];
  eliminating: boolean;
  autoRunning: boolean;
  isStop: boolean;
  step: number;
}

interface Trip {
  count: number;
  choose: number;
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
    backupGrid: [
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
    // 加载棋盘
    async load(file: File) {
      const toast = toastFactory();
      const settingStore = useSettingStore();

      // 优先自动检测棋盘位置(自适应任意分辨率/机型/棋盘位置), 失败则回退到所选归一化预设
      let targetRegion = await detectBoardRegion(file, settingStore.rows, settingStore.cols);
      if (!targetRegion) {
        console.warn('自动检测棋盘失败, 回退到裁剪预设:', settingStore.model);
        targetRegion = BOARD_REGIONS.find(region => region.id === settingStore.model) ?? BOARD_REGIONS[0];
      }

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

    // 执行【移动】操作
    async execMove(move: EffectiveMove): Promise<void> {
      const settingStore = useSettingStore();

      return new Promise(async resolve => {
        await highlight({ point1: move.tileVector.start, point2: move.tileVector.end }, settingStore.autoPlayDuration);

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
              area: { point1: move.tileVector.start, point2: move.tileVector.end },
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

      // 备份棋盘状态
      this.backupGrid = this.grid.map(row => [...row]);

      const path: Trip[] = [];
      let index = 0;
      while (true) {
        if (this.isStop) {
          break;
        }

        if (this.moves.length === 0 && this.eliminates.length === 0) {
          if (this.isSuccess) {
            console.log('成功');
            toast.success('执行结束', '已成功消除所有格子');
          }
          break;
        }

        // 执行【全部消除】
        await this.execEliminateAll();

        if (this.moves.length > 0) {
          // 执行第一个【移动】
          path.push({ count: this.moves.length, choose: 0 });
          const move = this.moves[0];
          await this.execMove(move);

          index += 1;
        }
      }

      if (!this.isStop && !this.isSuccess) {
        console.log('执行结束: 出现死局, 继续尝试其他可能');
        let max = 10;

        for (const current of generateCombinations(path.map(i => i.count - 1))) {
          await this.tryAgain(current);
          if (this.isSuccess) {
            break;
          }
          if (max-- === 0) {
            break;
          }
        }
      }

      this.autoRunning = false;
      this.isStop = false;
    },

    async tryAgain(executePath: number[]): Promise<boolean> {
      const toast = toastFactory();

      // 恢复棋盘状态
      this.grid = this.backupGrid.map(row => [...row]);
      // 棋盘已重置, 之前记录的步骤作废, 重新记录本次尝试的路径
      useReplayStore().reset();

      let index = 0;
      while (true) {
        if (this.isStop) {
          break;
        }

        if (this.moves.length === 0 && this.eliminates.length === 0) {
          if (this.isSuccess) {
            console.log('成功');
            toast.success('执行结束', '已成功消除所有格子');
            console.log(`执行路径: ${executePath}`);
          }
          break;
        }

        // 执行【全部消除】
        await this.execEliminateAll();

        if (this.moves.length > 0) {
          // 执行第一个【移动】
          let choose = 0;
          if (typeof executePath[index] === 'number' && executePath[index] < this.moves.length) {
            choose = executePath[index];
          }
          const move = this.moves[choose];
          await this.execMove(move);

          index += 1;
        }
      }

      return this.isSuccess;
    },

    stop() {
      this.isStop = true;
    },
  },
});

function* generateCombinations(limits: number[]) {
  function* recurse(pos: number, current: number[]): Generator<number[]> {
    if (pos === limits.length) {
      yield [...current];
      return;
    }
    for (let i = 0; i <= limits[pos]; i++) {
      current[pos] = i;
      yield* recurse(pos + 1, current);
    }
  }
  yield* recurse(0, []);
}
