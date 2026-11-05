import type { Coordinate, EffectiveMove, EliminateBlock } from '~/types/board';
import { Board } from '~/utils/Board';

// 求解动作: 一次消除或一次移动, 携带在"搜索时棋盘状态"下有效的坐标信息
export type SolveAction = { type: 'eliminate'; block: EliminateBlock } | { type: 'move'; move: EffectiveMove };

function countTiles(grid: number[][]): number {
  let n = 0;
  for (const row of grid) {
    for (const v of row) if (v !== 0) n++;
  }
  return n;
}

// ========== P0: 奇偶性剪枝 (来自 zhuanlegezhuan-solver-2) ==========
// 数独原理: 每次消除必须成对, 若某类图标剩余数为奇数则不可能全消
function oddTypes(grid: number[][]): number[] {
  const counts = new Map<number, number>();
  for (const row of grid) {
    for (const v of row) {
      if (v !== 0) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
  }
  const odds: number[] = [];
  for (const [k, n] of counts) if (n % 2 !== 0) odds.push(k);
  return odds;
}

// 各图标剩余数 Map —— 用于 moveScore
function countsById(grid: number[][]): Map<number, number> {
  const m = new Map<number, number>();
  for (const row of grid) {
    for (const v of row) {
      if (v !== 0) m.set(v, (m.get(v) ?? 0) + 1);
    }
  }
  return m;
}

// ========== P3: directPairCount 启发式 (来自 zhuanlegezhuan-solver-1) ==========
// 棋盘上下左右四个方向的相邻同色对总数, 衡量当前盘面"可直接点消的潜力"
function directPairCount(grid: number[][]): number {
  const rows = grid.length;
  const cols = grid[0].length;
  let cnt = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = grid[r][c];
      if (v === 0) continue;
      // 右邻居
      if (c + 1 < cols && grid[r][c + 1] === v) cnt++;
      // 下邻居
      if (r + 1 < rows && grid[r + 1][c] === v) cnt++;
    }
  }
  return cnt;
}

// ========== P5: 同列上下异种紧邻(竖列互锁)启发式 ==========
// 同一列上下紧邻的两块砖种类不同时, 它们各自的同伴会被对方挡住, 互相锁死:
// 例如 C1 列 R5 草 / R6 圆筒紧邻, 则 R1 圆筒与 R6 圆筒、R5 草与 R14 草两对都互相不可见,
// 一旦留到最后就会既不能点消也不能移动, 成为死局。
// 因此这类队列必须尽早拆解: 优先消除紧邻的异种砖, 其次优先消除该列上的任意砖。
function mixedVAdjacentFlags(grid: number[][]): { cells: boolean[][]; cols: boolean[] } {
  const rows = grid.length;
  const cols = grid[0].length;
  const cells = grid.map(row => row.map(() => false));
  const colFlags = new Array<boolean>(cols).fill(false);
  for (let c = 0; c < cols; c++) {
    for (let r = 1; r < rows; r++) {
      const up = grid[r - 1][c];
      const down = grid[r][c];
      if (up !== 0 && down !== 0 && up !== down) {
        cells[r - 1][c] = true;
        cells[r][c] = true;
        colFlags[c] = true;
      }
    }
  }
  return { cells, cols: colFlags };
}

// 紧邻异种砖对数量: 衡量盘面"竖列互锁"程度, 新状态下越少越好
function mixedVAdjacentPairCount(grid: number[][]): number {
  let cnt = 0;
  const rows = grid.length;
  const cols = grid[0].length;
  for (let c = 0; c < cols; c++) {
    for (let r = 1; r < rows; r++) {
      const up = grid[r - 1][c];
      const down = grid[r][c];
      if (up !== 0 && down !== 0 && up !== down) cnt++;
    }
  }
  return cnt;
}

// 单个格子的拆解优先级: 2=紧邻异种砖(直接拆锁) 1=所在列存在异种紧邻 0=无关
function mixedPriority(flags: { cells: boolean[][]; cols: boolean[] }, point: Coordinate): number {
  if (flags.cells[point.r][point.c]) return 2;
  return flags.cols[point.c] ? 1 : 0;
}

// ========== P4: Zobrist 风格 128 位状态哈希 (来自 zhuanlegezhuan-solver-1) ==========
// 避免每次 stateKey 都 join 字符串, 改为预计算随机 XOR 表 + 增量更新
const ZOBRIST_A = new Map<string, bigint>();
const ZOBRIST_B = new Map<string, bigint>();
let zobristInitialized = false;

function initZobrist(grid: number[][]): void {
  if (zobristInitialized) return;
  // 收集所有可能出现的 tile id
  const ids = new Set<number>();
  for (const row of grid) for (const v of row) if (v !== 0) ids.add(v);
  // 用确定性种子生成 64 位随机数 (mulberry32)
  const randA = mulberry32(0x12345678);
  const randB = mulberry32(0xabcdef01);
  const rows = grid.length;
  const cols = grid[0].length;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      for (const id of ids) {
        const key = `${r},${c},${id}`;
        ZOBRIST_A.set(key, BigInt(Math.floor(randA() * Number.MAX_SAFE_INTEGER)));
        ZOBRIST_B.set(key, BigInt(Math.floor(randB() * Number.MAX_SAFE_INTEGER)));
      }
    }
  }
  zobristInitialized = true;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 计算初始状态的完整 Zobrist 哈希
function zobristHash(grid: number[][]): { a: bigint; b: bigint } {
  initZobrist(grid);
  let a = 0n;
  let b = 0n;
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[0].length; c++) {
      const v = grid[r][c];
      if (v === 0) continue;
      const key = `${r},${c},${v}`;
      a ^= ZOBRIST_A.get(key) ?? 0n;
      b ^= ZOBRIST_B.get(key) ?? 0n;
    }
  }
  return { a, b };
}

// 用字符串作为 Set key (把 bigint 转成可读短串), 比原 join 更快且内存更省
function zobristKey(h: { a: bigint; b: bigint }): string {
  // 截断到 53 位数字避免字符串过长, 仍有足够区分度
  return `${Number(h.a & 0x1fffffffffffffn).toString(36)}:${Number(h.b & 0x1fffffffffffffn).toString(36)}`;
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
  // P2: beamWidth 截断 —— 每个状态最多尝试前 N 个最优 moves, 0=不截断
  beamWidth?: number;
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
 * 回溯搜索(DFS + 多层启发式剪枝): 在棋盘副本上求解, 不产生任何 UI 副作用。
 *
 * 整合自 5 个开源求解器的启发式:
 *   P0 奇偶性剪枝  (zhuanlegezhuan-solver-2) —— O(1) 数独原理检查
 *   P1 moveScore   (zhuanlegezhuan-solver-2) —— 少移动/稀缺图标/近距目标 优先
 *   P2 beamWidth   (zhuanlegezhuan-solver-2) —— 每状态截断前 N 个最优分支
 *   P3 directPairCount (zhuanlegezhuan-solver-1) —— 相邻同色对数量衡量"盘面活力"
 *   P4 Zobrist 哈希 (zhuanlegezhuan-solver-1) —— 128 位 XOR 哈希替代字符串 join
 *   P5 同列异种紧邻 —— 竖列互锁队形优先拆解, 避免留到最后成为死局
 *
 * 此前随机贪心推演无法全消的根因: 同色三连续(如 C1 列 R9/R10/R11)存在"中+上"与"中+下"
 * 两种消除分支, 随机贪心一旦选错就走进死局且无法回退。
 *
 * 找到完整全解立即返回; 否则返回搜索到的最优部分解(真实死局盘面确实无法全消)。
 * 返回 null 仅当用户中途停止。
 */
export async function searchSolution(grid: number[][], options: SearchOptions = {}): Promise<SearchResult | null> {
  const { maxPlayouts = 15000, budgetMs = 120000, shouldStop, onProgress, beamWidth = 0 } = options;
  const t0 = Date.now();
  const nodeLimit = Math.max(40000, maxPlayouts * 4);

  // ======= P4: 初始化 Zobrist 表 & 初始哈希 =======
  initZobrist(grid);
  let zob = zobristHash(grid);

  // ======= P0: 初始奇偶检查 (仅告警, 不阻止搜索) =======
  const initialOdds = oddTypes(grid);
  if (initialOdds.length > 0) {
    console.warn(`[solver] 初始盘面存在奇数数量类别: ${initialOdds.join(', ')} — 可能不可解`);
  }

  const dead = new Set<string>(); // 已确认无法全解的状态 (key = zobristKey)
  const path: SolveAction[] = [];
  let nodes = 0;
  let aborted = false;
  let bestRemain = countTiles(grid);
  let bestPath: SolveAction[] = [];

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

    // ======= P0: DFS 内奇偶剪枝 =======
    if (remain % 2 !== 0) return false;
    const odds = oddTypes(g);
    if (odds.length > 0) return false;

    // ======= P4: Zobrist key 查 dead =======
    const key = zobristKey(zob);
    if (dead.has(key)) return false;

    // ======= 枚举点消分支 + 移动分支 =======
    const elims = board.findAllEliminateBlock();
    const moves = board.findAllEffectiveMoves();

    // ======= P1 + P3: moveScore 统一排序 =======
    // 消除分支和移动分支统一打分: 点消 shift=0 → 最优先; 稀缺图标优先; 近距目标优先
    const counts = countsById(g);
    const directPairs = directPairCount(g);
    // P5: 当前盘面的竖列互锁标记, 用于给"拆锁"动作加权
    const mixedFlags = mixedVAdjacentFlags(g);

    type Branch =
      | { kind: 'eliminate'; block: EliminateBlock; next: number[][]; score: number }
      | { kind: 'move'; move: EffectiveMove; next: number[][]; score: number };

    const branches: Branch[] = [];

    for (const block of elims) {
      const next = board.execEliminate(block);
      if (!next) continue;
      // shift=0, 距离=0, 稀缺图标优先
      const remainingOfId = counts.get(block.value) ?? 0;
      // 打分: shift*1000 + 稀缺度 + 直接对提升 (P3)
      const nextPairs = directPairCount(next);
      // P5: 消除紧邻异种砖(直接拆锁) > 消除互锁列上的砖 > 无关
      const mixPrio = mixedPriority(mixedFlags, block.point1) + mixedPriority(mixedFlags, block.point2);
      const nextMix = mixedVAdjacentPairCount(next);
      // 越低越优
      const score = -mixPrio * 400 + nextMix * 200 + remainingOfId * 20 - nextPairs * 2;
      branches.push({ kind: 'eliminate', block, next, score });
    }

    for (const move of moves) {
      const [next] = board.execMove(move);
      // shift = 滑动距离, value 从 eliminate 对中取
      const v = move.eliminate.value;
      const remainingOfId = counts.get(v) ?? 0;
      const dist = move.distance;
      const nextPairs = directPairCount(next);
      // P5: 移动后消失的砖块同样按"是否在竖列互锁中"加权
      const mixPrio =
        mixedPriority(mixedFlags, move.eliminate.point1) + mixedPriority(mixedFlags, move.eliminate.point2);
      const nextMix = mixedVAdjacentPairCount(next);
      // P1 核心公式 + P3/P5 辅助: shift*1000 主导, 稀缺度次之, 拆锁与对提升最后
      const score = move.distance * 1000 + remainingOfId * 20 + dist - nextPairs * 2 - mixPrio * 400 + nextMix * 200;
      branches.push({ kind: 'move', move, next, score });
    }

    // 按 score 升序排列 (低优先)
    branches.sort((a, b) => a.score - b.score);

    // ======= P2: beamWidth 截断 =======
    if (beamWidth > 0 && branches.length > beamWidth) {
      branches.length = beamWidth;
    }

    // 保存当前 zob 以便回溯时恢复
    const prevZob = zob;

    for (const br of branches) {
      // ======= P4: 增量 Zobrist 更新 =======
      // 计算 next 的哈希: 从 prev 的基础上 XOR 差异位置
      zob = incrementalZobrist(prevZob, g, br.next);

      if (br.kind === 'eliminate') {
        path.push({ type: 'eliminate', block: br.block });
      } else {
        path.push({ type: 'move', move: br.move });
      }

      if (dfs(br.next)) return true;

      path.pop();
      zob = prevZob; // 恢复
      if (aborted) return false;
    }

    dead.add(key);
    return false;
  };

  const complete = dfs(grid);
  // 让出主线程, 保证界面已更新的进度/结果能被渲染
  await new Promise(resolve => setTimeout(resolve, 0));

  if (aborted && shouldStop?.()) return null;
  if (complete) return { actions: path.slice(), complete: true, remain: 0 };
  return { actions: bestPath, complete: false, remain: bestRemain };
}

// ======= P4 辅助: 增量 Zobrist 更新 =======
// 比较 prevGrid 和 nextGrid, 对所有变化位置执行 XOR diff
function incrementalZobrist(
  prevHash: { a: bigint; b: bigint },
  prevGrid: number[][],
  nextGrid: number[][]
): { a: bigint; b: bigint } {
  let a = prevHash.a;
  let b = prevHash.b;
  const rows = prevGrid.length;
  const cols = prevGrid[0].length;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v1 = prevGrid[r][c];
      const v2 = nextGrid[r][c];
      if (v1 === v2) continue;
      if (v1 !== 0) {
        const k = `${r},${c},${v1}`;
        a ^= ZOBRIST_A.get(k) ?? 0n;
        b ^= ZOBRIST_B.get(k) ?? 0n;
      }
      if (v2 !== 0) {
        const k = `${r},${c},${v2}`;
        a ^= ZOBRIST_A.get(k) ?? 0n;
        b ^= ZOBRIST_B.get(k) ?? 0n;
      }
    }
  }
  return { a, b };
}
