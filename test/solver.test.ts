import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Board } from '~/utils/Board';
import { type SolveAction, searchSolution } from '~/utils/solver';

function emptyBoard(rows = 14, cols = 10): number[][] {
  return Array.from({ length: rows }).map(() => Array.from({ length: cols }).fill(0) as number[]);
}

/** 回放动作序列: 每一步都必须真实可执行, 返回最终棋盘 */
function replay(grid: number[][], actions: SolveAction[]): number[][] {
  let board = new Board(grid);
  for (const action of actions) {
    if (action.type === 'eliminate') {
      const next = board.execEliminate(action.block);
      assert.ok(next, `非法点消: ${JSON.stringify(action.block)}`);
      board = new Board(next);
    } else {
      const [next] = board.execMove(action.move);
      board = new Board(next);
    }
  }
  return board.grid;
}

/**
 * 竖列互锁盘面 (对应截图 C1 列的队形):
 *   C1 列 R1=A / R5=B / R6=A / R14=B —— R5 与 R6 上下紧邻且异种, 两对同伴互相被挡
 * 同时 C2 列提供 B 的同伴(C2R5/C2R14), 用于拆锁;
 * 另在 C4/C5 列放两组"干扰对", 用来验证求解器不会被它们带偏。
 */
function interlockedBoard(): number[][] {
  const g = emptyBoard();
  g[0][0] = 1; // C1 R1 A
  g[4][0] = 2; // C1 R5 B  <- 与 R6 异种紧邻
  g[5][0] = 1; // C1 R6 A
  g[13][0] = 2; // C1 R14 B
  g[4][1] = 2; // C2 R5 B: 拆锁关键
  g[13][1] = 2; // C2 R14 B
  g[0][3] = 1; // 干扰对 A: C4/C5 R1
  g[0][4] = 1;
  g[7][3] = 2; // 干扰对 B: C4/C5 R8
  g[7][4] = 2;
  return g;
}

describe('P5 同列上下异种紧邻启发式', () => {
  it('优先消除紧邻的异种砖, 而不是先消远处的干扰对', async () => {
    const grid = interlockedBoard();
    const result = await searchSolution(grid, { maxPlayouts: 5000, budgetMs: 10000 });

    assert.ok(result, '应返回搜索结果');
    assert.equal(result.complete, true, '该盘面可全解');

    const first = result.actions[0];
    assert.equal(first?.type, 'eliminate', '首个动作应为点消');
    if (first?.type !== 'eliminate') return;

    // 首个动作必须拆掉互锁列上紧邻异种的那块砖 (C1 R5, 即 (4,0))
    const points = [first.block.point1, first.block.point2];
    assert.ok(
      points.some(p => p.r === 4 && p.c === 0),
      `首个动作未拆解互锁队形, 实际为 ${JSON.stringify(points)}`
    );
  });

  it('拆锁后同列两块同种砖立即成为可见对', async () => {
    const grid = interlockedBoard();
    const result = await searchSolution(grid, { maxPlayouts: 5000, budgetMs: 10000 });
    assert.ok(result?.complete);

    const second = result.actions[1];
    assert.equal(second?.type, 'eliminate');
    if (second?.type !== 'eliminate') return;

    // C1 R1(0,0) 与 R6(5,0) 之间的阻挡砖被消掉后, 两者同列可见, 应立即成对消除
    const points = [second.block.point1, second.block.point2];
    const verticalPair = points.some(p => p.r === 0 && p.c === 0) && points.some(p => p.r === 5 && p.c === 0);
    assert.ok(verticalPair, `第二步未消除拆锁后的同列同种对, 实际为 ${JSON.stringify(points)}`);
  });

  it('互锁盘面能完整解出, 且路径每一步都合法', async () => {
    const grid = interlockedBoard();
    const result = await searchSolution(grid, { maxPlayouts: 5000, budgetMs: 10000 });
    assert.ok(result?.complete);

    const finalGrid = replay(grid, result.actions);
    assert.ok(new Board(finalGrid).isSuccess(), '回放后应全部消除');
  });

  it('截图中真正的死局如实报告不可全解, 不产生多余动作', async () => {
    const g = emptyBoard();
    g[0][0] = 1; // R1 圆筒
    g[4][0] = 2; // R5 草
    g[5][0] = 1; // R6 圆筒
    g[13][0] = 2; // R14 草

    const board = new Board(g);
    assert.equal(board.findAllEliminateBlock().length, 0, '死局不应存在可点消对');
    assert.equal(board.findAllEffectiveMoves().length, 0, '死局不应存在能产生消除的移动');

    const result = await searchSolution(g, { maxPlayouts: 5000, budgetMs: 10000 });
    assert.ok(result);
    assert.equal(result.complete, false);
    assert.equal(result.remain, 4);
    assert.deepEqual(result.actions, []);
  });

  it('没有互锁队形的普通盘面仍能全解 (无回归)', async () => {
    const g = emptyBoard();
    g[0][0] = 1; // R1 C1/C2 A
    g[0][1] = 1;
    g[3][4] = 2; // R4 C5/C6 B
    g[3][5] = 2;
    g[7][2] = 3; // R8 C3, R8 C4 C
    g[7][3] = 3;

    const result = await searchSolution(g, { maxPlayouts: 5000, budgetMs: 10000 });
    assert.ok(result?.complete);
    assert.equal(result.remain, 0);

    const finalGrid = replay(g, result.actions);
    assert.ok(new Board(finalGrid).isSuccess());
  });
});
