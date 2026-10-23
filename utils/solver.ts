import type { EffectiveMove, EliminateBlock } from '~/types/board';
import { Board, DIRECTION } from '~/utils/Board';

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

// 扩展的有效移动枚举: 除"移动段自身参与消除"外, 还包含"腾位移动"——
// 滑走某些格子后, 原地不动的两个相同格子因中间清空而相邻消除。
// (Board.findAllEffectiveMoves 只认前者, 会在 3-5-3-5 这类残局中误判死局)
function findAllMovesExtended(board: Board): EffectiveMove[] {
  const moves: EffectiveMove[] = [];
  const seen = new Set<string>();

  for (const hole of board.findHoleTiles()) {
    for (const direction of [DIRECTION.UP, DIRECTION.DOWN, DIRECTION.LEFT, DIRECTION.RIGHT]) {
      const tileVector = board.findTileVector(hole, direction);
      if (!tileVector) continue;
      const maxDistance = board.distance(tileVector.start, hole);
      const moveDir = board.reverseDir(direction);

      for (let step = 1; step <= maxDistance; step++) {
        const move = {
          direction: moveDir,
          distance: step,
          tileVector,
          eliminate: null as unknown as EffectiveMove['eliminate'],
        };
        const [nextGrid] = board.execMove(move);
        const elims = new Board(nextGrid).findAllEliminateBlock();
        if (elims.length === 0) continue;
        const key = `${tileVector.start.r},${tileVector.start.c},${tileVector.end.r},${tileVector.end.c},${moveDir.name},${step}`;
        if (seen.has(key)) continue;
        seen.add(key);
        move.eliminate = elims[0];
        moves.push(move);
      }
    }
  }
  return moves;
}

// 单次随机推演: 有可消对时随机消一对, 没有时随机选一个"有效移动"(保证移动后必产生可消对)
function playout(grid: number[][], rand: () => number, stepLimit = 5000): PlayoutResult {
  let current = grid.map(row => [...row]);
  const actions: SolveAction[] = [];

  for (let step = 0; step < stepLimit; step++) {
    const board = new Board(current);
    if (board.isSuccess()) {
      return { complete: true, actions, remain: 0 };
    }

    const elims = board.findAllEliminateBlock();
    if (elims.length > 0) {
      const block = elims[Math.floor(rand() * elims.length)];
      const next = board.execEliminate(block);
      if (!next) break;
      current = next;
      actions.push({ type: 'eliminate', block });
      continue;
    }

    const moves = findAllMovesExtended(board);
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

/**
 * 随机重启搜索: 在棋盘副本上快速推演(不产生任何 UI 副作用),
 * 找到一条完整的全消除路径则返回动作序列, 否则返回 null。
 */
export async function searchSolution(grid: number[][], options: SearchOptions = {}): Promise<SolveAction[] | null> {
  const { maxPlayouts = 3000, budgetMs = 25000, seed = Date.now() >>> 0, shouldStop, onProgress } = options;
  const t0 = Date.now();
  let bestRemain = Infinity;

  for (let i = 0; i < maxPlayouts; i++) {
    if (shouldStop?.()) return null;

    const rand = mulberry32((seed + Math.imul(i + 1, 2654435761)) >>> 0);
    const result = playout(grid, rand);
    if (result.complete) return result.actions;
    if (result.remain < bestRemain) bestRemain = result.remain;

    // 每 10 次让出主线程, 保持界面可交互/可显示进度
    if ((i + 1) % 10 === 0) {
      onProgress?.(i + 1, bestRemain);
      await new Promise(resolve => setTimeout(resolve, 0));
      if (Date.now() - t0 > budgetMs) break;
    }
  }

  return null;
}
