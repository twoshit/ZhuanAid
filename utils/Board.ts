import type { Coordinate, Direction, DirectionName, EffectiveMove, EliminateBlock, TileVector } from '~/types/board';

export const DIRECTION: Record<DirectionName, Direction> = {
  UP: { dr: -1, dc: 0, name: 'UP' },
  DOWN: { dr: 1, dc: 0, name: 'DOWN' },
  LEFT: { dr: 0, dc: -1, name: 'LEFT' },
  RIGHT: { dr: 0, dc: 1, name: 'RIGHT' },
};

const ALL_DIRECTIONS = [DIRECTION.UP, DIRECTION.DOWN, DIRECTION.LEFT, DIRECTION.RIGHT];

/**
 * 游戏规则模型 (对齐 game_crack.py 中的规则注释):
 * 1. 消除条件: 两块同色砖在上下左右方向上互相"可见"(中间无其他砖阻挡, 可隔空格)。
 *    - 规则1: 静止状态下即可见的同色对, 可直接点击消除(相当于移动 0 格)
 *    - 规则2: 砖滑动后, 在新位置与可见的同色砖成对消除; 每次移动只消一对
 *      且要求从【原始位置】沿拖动方向到配对砖的直线路径不被阻挡(对齐 game_crack.py is_blocked)
 * 2. 移动(推箱子): 将一块砖朝某方向滑动 k 格, 该砖该方向上相连的所有砖一起滑动 k 格,
 *    且相连段外侧朝该方向必须有至少 k 格连续空格。行/列中间的空格同样可以利用。
 * 3. 不产生消除的滑动为无效移动(弹回)。
 */
export class Board {
  grid: number[][];
  rows: number;
  cols: number;

  constructor(grid: number[][]) {
    this.grid = grid.map((row: number[]) => [...row]);
    this.rows = grid.length;
    this.cols = grid[0].length;
  }

  clone(): Board {
    return new Board(this.grid);
  }

  isSuccess(): boolean {
    for (const row of this.grid) {
      for (const cell of row) {
        if (cell !== 0) return false;
      }
    }
    return true;
  }

  formatCoordinate(coordinate: Coordinate): string {
    return `(R${coordinate.r + 1},C${coordinate.c + 1})`;
  }

  inBoard(point: Coordinate): boolean {
    return point.r >= 0 && point.r < this.rows && point.c >= 0 && point.c < this.cols;
  }

  getTileValue(point: Coordinate): number {
    return this.grid[point.r][point.c];
  }

  setTileValue(point: Coordinate, value: number) {
    this.grid[point.r][point.c] = value;
  }

  isHoleTile(point: Coordinate): boolean {
    return this.grid[point.r][point.c] === 0;
  }

  tick(point: Coordinate, direction: Direction, distance: number): Coordinate | null {
    const p = { r: point.r + direction.dr * distance, c: point.c + direction.dc * distance };
    return this.inBoard(p) ? p : null;
  }

  // 从 point 沿 direction 跨过空格, 找到第一块非空砖(无则 null)
  private firstVisible(point: Coordinate, direction: Direction): Coordinate | null {
    let q = this.tick(point, direction, 1);
    while (q && this.isHoleTile(q)) q = this.tick(q, direction, 1);
    return q;
  }

  // 两块是否互相"可见": 同色非空, 且在同一行/列上跨空格直达(中间无其他砖)
  private isVisiblePair(p1: Coordinate, p2: Coordinate): boolean {
    const v = this.grid[p1.r][p1.c];
    if (v === 0 || this.grid[p2.r][p2.c] !== v) return false;
    if (p1.r === p2.r) {
      const dir = p2.c > p1.c ? DIRECTION.RIGHT : DIRECTION.LEFT;
      const q = this.firstVisible(p1, dir);
      return !!q && q.r === p2.r && q.c === p2.c;
    }
    if (p1.c === p2.c) {
      const dir = p2.r > p1.r ? DIRECTION.DOWN : DIRECTION.UP;
      const q = this.firstVisible(p1, dir);
      return !!q && q.r === p2.r && q.c === p2.c;
    }
    return false;
  }

  /**
   * 所有可直接点消的对(规则1): 上下左右跨空格可见的同色砖对, 每对只记录一次
   */
  findAllEliminateBlock(): EliminateBlock[] {
    const blocks: EliminateBlock[] = [];
    const seen = new Set<string>();
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const v = this.grid[r][c];
        if (v === 0) continue;
        for (const d of ALL_DIRECTIONS) {
          const q = this.firstVisible({ r, c }, d);
          if (q && this.grid[q.r][q.c] === v) {
            const key =
              r < q.r || (r === q.r && c <= q.c)
                ? `${r},${c}|${q.r},${q.c}`
                : `${q.r},${q.c}|${r},${c}`;
            if (seen.has(key)) continue;
            seen.add(key);
            blocks.push({ value: v, point1: { r, c }, point2: { r: q.r, c: q.c } });
          }
        }
      }
    }
    return blocks;
  }

  /**
   * 执行点消: 两点必须同色且互相可见
   */
  execEliminate(eliminate: EliminateBlock): number[][] | null {
    const { point1, point2 } = eliminate;
    if (!this.inBoard(point1) || !this.inBoard(point2)) {
      console.warn('点消无效: 坐标越界');
      return null;
    }
    if (!this.isVisiblePair(point1, point2)) {
      console.warn(
        `点消无效: ${this.formatCoordinate(point1)} 与 ${this.formatCoordinate(point2)} 不是可见同色对`
      );
      return null;
    }
    const board = this.clone();
    board.setTileValue(point1, 0);
    board.setTileValue(point2, 0);
    return board.grid;
  }

  // 从 start 沿 direction 的连续砖段末端(含 start 自身)
  private segmentEnd(start: Coordinate, direction: Direction): Coordinate {
    let cur = start;
    let next = this.tick(cur, direction, 1);
    while (next && !this.isHoleTile(next)) {
      cur = next;
      next = this.tick(cur, direction, 1);
    }
    return cur;
  }

  // 连续砖段末端朝 direction 方向的连续空格数
  private roomAfter(end: Coordinate, direction: Direction): number {
    let room = 0;
    let q = this.tick(end, direction, 1);
    while (q && this.isHoleTile(q)) {
      room++;
      q = this.tick(q, direction, 1);
    }
    return room;
  }

  // 模拟: 把 start..end 的砖段沿 direction 滑 i 格后, 被拖砖在新位置可见的同色对; 无则 null
  private slidePair(start: Coordinate, direction: Direction, i: number): EliminateBlock | null {
    const end = this.segmentEnd(start, direction);
    const horizontal = direction.dc !== 0;
    const s = horizontal ? direction.dc * i : direction.dr * i;
    const bIdx = horizontal ? start.c : start.r;
    const eIdx = horizontal ? end.c : end.r;

    // 滑动后的"所在线"副本(只有该砖段移动)
    const line: number[] = horizontal
      ? [...this.grid[start.r]]
      : this.grid.map(row => row[start.c]);
    const lo = Math.min(bIdx, eIdx);
    const hi = Math.max(bIdx, eIdx);
    const v = line[bIdx];
    const values: number[] = [];
    for (let k = lo; k <= hi; k++) {
      values.push(line[k]);
      line[k] = 0;
    }
    for (let k = lo; k <= hi; k++) line[k + s] = values[k - lo];

    // 被拖砖的新位置
    const newPoint: Coordinate = horizontal
      ? { r: start.r, c: start.c + s }
      : { r: start.r + s, c: start.c };
    const newIdx = bIdx + s;

    const pointOf = (idx: number): Coordinate =>
      horizontal ? { r: start.r, c: idx } : { r: idx, c: start.c };

    // 仅沿【运动方向】扫描(真机验证: 反方向与垂直方向的同色对不触发消除)
    const step = horizontal ? direction.dc : direction.dr;
    let k = newIdx + step;
    while (k >= 0 && k < line.length && line[k] === 0) k += step;
    if (k >= 0 && k < line.length && line[k] === v) return { value: v, point1: newPoint, point2: pointOf(k) };
    return null;
  }

  /**
   * 所有有效移动(规则2): 推箱子段滑动 k 格且被拖砖在新位置可见同色砖
   * tileVector: start=被拖砖, end=该方向相连段末端; direction/distance=滑动
   */
  findAllEffectiveMoves(): EffectiveMove[] {
    const moves: EffectiveMove[] = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.grid[r][c] === 0) continue;
        const start = { r, c };
        for (const d of ALL_DIRECTIONS) {
          const end = this.segmentEnd(start, d);
          const room = this.roomAfter(end, d);
          for (let i = 1; i <= room; i++) {
            const pair = this.slidePair(start, d, i);
            if (!pair) continue;
            moves.push({
              direction: d,
              distance: i,
              tileVector: { start, end, direction: d },
              eliminate: pair,
            });
          }
        }
      }
    }
    return moves;
  }

  /**
   * 执行【移动】: 段滑动 + 消除被拖砖与新位置可见对, 返回最终棋盘与滑动后的线段位置
   */
  execMove(move: EffectiveMove): [number[][], TileVector] {
    const { tileVector, direction, distance } = move;
    const start = tileVector.start;
    const end = this.segmentEnd(start, direction);
    const room = this.roomAfter(end, direction);
    const pair = distance <= room ? this.slidePair(start, direction, distance) : null;
    if (!pair) {
      console.warn('执行了无效移动(不会产生消除), 弹回');
      return [this.grid.map(row => [...row]), tileVector];
    }
    const horizontal = direction.dc !== 0;
    const s = horizontal ? direction.dc * distance : direction.dr * distance;
    const grid = this.grid.map(row => [...row]);
    // 滑动砖段
    if (horizontal) {
      const lo = Math.min(start.c, end.c);
      const hi = Math.max(start.c, end.c);
      const values: number[] = [];
      for (let c = lo; c <= hi; c++) {
        values.push(grid[start.r][c]);
        grid[start.r][c] = 0;
      }
      for (let c = lo; c <= hi; c++) grid[start.r][c + s] = values[c - lo];
    } else {
      const lo = Math.min(start.r, end.r);
      const hi = Math.max(start.r, end.r);
      const values: number[] = [];
      for (let r = lo; r <= hi; r++) {
        values.push(grid[r][start.c]);
        grid[r][start.c] = 0;
      }
      for (let r = lo; r <= hi; r++) grid[r + s][start.c] = values[r - lo];
    }
    // 消除被拖砖新位置与可见对
    const newPoint: Coordinate = horizontal
      ? { r: start.r, c: start.c + s }
      : { r: start.r + s, c: start.c };
    grid[newPoint.r][newPoint.c] = 0;
    grid[pair.point2.r][pair.point2.c] = 0;

    const movedTileVector: TileVector = {
      start: newPoint,
      end: { r: end.r + direction.dr * distance, c: end.c + direction.dc * distance },
      direction,
    };
    return [grid, movedTileVector];
  }
}
