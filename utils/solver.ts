import type { EffectiveMove, EliminateBlock } from '~/types/board';
import { Board } from '~/utils/Board';

// 求解动作: 一次消除或一次移动, 携带在"搜索时棋盘状态"下有效的坐标信息
export type SolveAction =
  | { type: 'eliminate'; block: EliminateBlock }
  | { type: 'move'; move: EffectiveMove };

interface PlayoutResult {
  complete: boolean;
  actions: SolveAction[];
  remain: number;
}

// 轻量确定性随机数 (mulberry32), 同一种子可复现同一条路径
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function countTiles(grid: number[][]): number {
  let n = 0;
  for (const row of grid) {
    for (const v of row) if (v !== 0) n++;
  }
  return n;
}

// 单次随机推演(真实规则模型):
// - 存在紧贴同色对: 大概率直接点消一对; 少数情况先尝试移动, 以探索"移动与点消的先后顺序"
// - 无紧贴对: 只能选一个能产生自动对消的刚性平移(整行/整列平移 k 格)
// - 两者都没有: 死局
function playout(grid: number[][], rand: () => number, stepLimit = 5000): PlayoutResult {
  let current = grid.map(row => [...row]);
  const actions: SolveAction[] = [];

  for (let step = 0; step < stepLimit; step++) {
    const board = new Board(current);
    if (board.isSuccess()) {
      return { complete: true, actions, remain: 0 };
    }

    const elims = board.findAllEliminateBlock();
    // 优先点消; 只有当点消概率落空或无紧贴对时才枚举移动(枚举移动开销较大, 按需计算)
    if (elims.length > 0 && (rand() < 0.75 || board.findAllEffectiveMoves().length === 0)) {
      const block = elims[Math.floor(rand() * elims.length)];
      const next = board.execEliminate(block);
      if (!next) break;
      current = next;
      actions.push({ type: 'eliminate', block });
      continue;
    }

    const moves = board.findAllEffectiveMoves();
    if (moves.length === 0) break;
    const move = moves[Math.floor(rand() * moves.length)];
    const [next] = board.execMove(move);
    current = next;
    actions.push({ type: 'move', move });
  }

  return { complete: false, actions, remain: countTiles(current) };
}

export interface SearchOptions {
  // 最大推演次数
  maxPlayouts?: number;
  // 时间预算(毫秒), 超时返回 null
  budgetMs?: number;
  // 随机种子
  seed?: number;
  // 用户取消检测
  shouldStop?: () => boolean;
  // 进度回调 (第几次尝试, 目前最优剩余格数)
  onProgress?: (attempt: number, bestRemain: number) => void;
}

export interface SearchResult {
  // 最优动作序列(完整全解或当前搜索到的最优部分解)
  actions: SolveAction[];
  // 是否找到完整全解
  complete: boolean;
  // 该路径结束后的剩余格数
  remain: number;
}

/**
 * 随机重启搜索: 在棋盘副本上快速推演(不产生任何 UI 副作用)。
 * 找到完整全解立即返回; 否则返回搜索到的最优部分解(真实规则下部分棋盘确实无法全消)。
 * 返回 null 仅当用户中途停止。
 */
export async function searchSolution(grid: number[][], options: SearchOptions = {}): Promise<SearchResult | null> {
  const { maxPlayouts = 3000, budgetMs = 25000, seed = Date.now() >>> 0, shouldStop, onProgress } = options;
  const t0 = Date.now();
  let bestRemain = Infinity;
  let bestActions: SolveAction[] = [];

  for (let i = 0; i < maxPlayouts; i++) {
    if (shouldStop?.()) return null;

    const rand = mulberry32((seed + Math.imul(i + 1, 2654435761)) >>> 0);
    const result = playout(grid, rand);
    if (result.complete) return { actions: result.actions, complete: true, remain: 0 };
    if (result.remain < bestRemain) {
      bestRemain = result.remain;
      bestActions = result.actions;
    }

    // 每 10 次让出主线程, 保持界面可交互/可显示进度
    if ((i + 1) % 10 === 0) {
      onProgress?.(i + 1, bestRemain);
      await new Promise(resolve => setTimeout(resolve, 0));
      if (Date.now() - t0 > budgetMs) break;
    }
  }

  return { actions: bestActions, complete: false, remain: bestRemain };
}
