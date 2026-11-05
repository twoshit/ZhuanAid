import type { EffectiveMove, EliminateBlock } from '~/types/board';
import { Board } from '~/utils/Board';

// 求解动作: 一次消除或一次移动, 携带在"搜索时棋盘状态"下有效的坐标信息
export type SolveAction =
  | { type: 'eliminate'; block: EliminateBlock }
  | { type: 'move'; move: EffectiveMove };

function countTiles(grid: number[][]): number {
  let n = 0;
  for (const row of grid) {
    for (const v of row) if (v !== 0) n++;
  }
  return n;
}

export interface SearchOptions {
  // 搜索节点预算(与推演规模成正比, 控制最大搜索量)
  maxPlayouts?: number;
  // 时间预算(毫秒), 超时返回当前最优部分解
  budgetMs?: number;
  // 预留参数(搜索为确定性算法, 同盘面始终得到同一最优解)
  seed?: number;
  // 用户取消检测
  shouldStop?: () => boolean;
  // 进度回调 (已搜索节点数, 目前最优剩余格数)
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
 * 回溯搜索(DFS + 死局记忆化): 在棋盘副本上求解, 不产生任何 UI 副作用。
 *
 * 关键点(此前随机贪心推演无法全消的原因):
 * - 同色的连续三砖(如 C1 列 R9/R10/R11)存在"中+上"与"中+下"两种消除分支,
 *   随机贪心一旦选错就走进死局且无法回退, 导致整盘无法全消。
 * - 这里对每个状态的所有可点消对/有效移动逐一尝试, 失败则回溯;
 *   已确认无解的状态记入 dead 集合避免重复搜索。
 *
 * 找到完整全解立即返回; 否则返回搜索到的最优部分解(真实死局盘面确实无法全消)。
 * 返回 null 仅当用户中途停止。
 */
export async function searchSolution(grid: number[][], options: SearchOptions = {}): Promise<SearchResult | null> {
  const { maxPlayouts = 15000, budgetMs = 120000, shouldStop, onProgress } = options;
  const t0 = Date.now();
  // 节点上限: 实测常规盘面全解只需约 1000 节点, 留足余量防止死局盘无限搜索
  const nodeLimit = Math.max(40000, maxPlayouts * 4);

  const dead = new Set<string>(); // 已确认无法全解的状态
  const path: SolveAction[] = [];
  let nodes = 0;
  let aborted = false;
  let bestRemain = countTiles(grid);
  let bestPath: SolveAction[] = [];

  const stateKey = (g: number[][]): string => g.map((row) => row.join(',')).join(';');

  const dfs = (g: number[][]): boolean => {
    if (aborted) return false;
    if (++nodes > nodeLimit) {
      aborted = true;
      return false;
    }
    if ((nodes & 2047) === 0) {
      onProgress?.(nodes, bestRemain);
      if (shouldStop?.() || Date.now() - t0 > budgetMs) {
        aborted = true;
        return false;
      }
    }

    const board = new Board(g);
    if (board.isSuccess()) return true;

    const remain = countTiles(g);
    if (remain < bestRemain) {
      bestRemain = remain;
      bestPath = path.slice();
    }

    const key = stateKey(g);
    if (dead.has(key)) return false;

    // 规则: 同色可见对(紧贴或隔空格)直接点击消除, 其他砖不移动; 因此优先穷尽点消分支。
    // 分支顺序按"消除后仍可点消对数更多"优先, 为后续保留更多选择余地(避免过早走进死角)。
    const elims = board.findAllEliminateBlock();
    const elimBranches = elims
      .map((block) => {
        const next = board.execEliminate(block);
        return next ? { block, next, room: new Board(next).findAllEliminateBlock().length } : null;
      })
      .filter((x): x is { block: EliminateBlock; next: number[][]; room: number } => !!x)
      .sort((a, b) => b.room - a.room);
    for (const { block, next } of elimBranches) {
      path.push({ type: 'eliminate', block });
      if (dfs(next)) return true;
      path.pop();
      if (aborted) return false;
    }

    // 没有点消可行时, 尝试推箱子有效移动(冗余移动已在 Board 中剔除)
    const moves = board.findAllEffectiveMoves();
    for (const move of moves) {
      const [next] = board.execMove(move);
      path.push({ type: 'move', move });
      if (dfs(next)) return true;
      path.pop();
      if (aborted) return false;
    }

    dead.add(key);
    return false;
  };

  const complete = dfs(grid);
  // 让出主线程, 保证界面已更新的进度/结果能被渲染
  await new Promise((resolve) => setTimeout(resolve, 0));

  if (aborted && shouldStop?.()) return null;
  if (complete) return { actions: path.slice(), complete: true, remain: 0 };
  return { actions: bestPath, complete: false, remain: bestRemain };
}
