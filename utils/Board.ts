import type { Coordinate, Direction, DirectionName, EffectiveMove, EliminateBlock, TileVector } from '~/types/board';

export const DIRECTION: Record<DirectionName, Direction> = {
  UP: { dr: -1, dc: 0, name: 'UP' },
  DOWN: { dr: 1, dc: 0, name: 'DOWN' },
  LEFT: { dr: 0, dc: -1, name: 'LEFT' },
  RIGHT: { dr: 0, dc: 1, name: 'RIGHT' },
};

const ALL_DIRECTIONS = [DIRECTION.UP, DIRECTION.DOWN, DIRECTION.LEFT, DIRECTION.RIGHT];

/**
 * 真实游戏规则模型:
 * 1. 手动消除: 点击两个"紧贴"(横/竖直接相邻)的同色砖, 二者消除(开局即靠此产生第一批空格)。
 * 2. 移动: 整行/整列作为整体刚性平移 k 格, 目标方向必须有足够空格, 砖不会被推出边缘;
 *    平移后若产生消除则本次拖动有效, 否则弹回(无效移动)。
 * 3. 移动后自动结算: 被移动过的砖, 与同行/同列"隔着空格相对或紧贴"的同色砖成对消除;
 *    没被移动过的砖之间即使对望也不消除。
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

  /**
   * 找出所有可手动点消的对: 紧贴(直接相邻)的同色砖对
   */
  findAllEliminateBlock(): EliminateBlock[] {
    const blocks: EliminateBlock[] = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const v = this.grid[r][c];
        if (v === 0) continue;
        if (c + 1 < this.cols && this.grid[r][c + 1] === v) {
          blocks.push({ value: v, point1: { r, c }, point2: { r, c: c + 1 } });
        }
        if (r + 1 < this.rows && this.grid[r + 1][c] === v) {
          blocks.push({ value: v, point1: { r, c }, point2: { r: r + 1, c } });
        }
      }
    }
    return blocks;
  }

  /**
   * 执行手动点消: 两点必须紧贴且同色
   */
  execEliminate(eliminate: EliminateBlock): number[][] | null {
    const { point1, point2 } = eliminate;
    const adjacent =
      (point1.r === point2.r && Math.abs(point1.c - point2.c) === 1) ||
      (point1.c === point2.c && Math.abs(point1.r - point2.r) === 1);
    if (!adjacent || !this.inBoard(point1) || !this.inBoard(point2)) {
      console.warn(`点消无效: ${this.formatCoordinate(point1)} 与 ${this.formatCoordinate(point2)} 不相邻`);
      return null;
    }
    if (this.grid[point1.r][point1.c] !== this.grid[point2.r][point2.c] || this.grid[point1.r][point1.c] === 0) {
      console.warn(
        `点消无效: ${this.formatCoordinate(point1)}(${this.grid[point1.r][point1.c]}) 与 ${this.formatCoordinate(point2)}(${this.grid[point2.r][point2.c]}) 不同色`
      );
      return null;
    }
    const board = this.clone();
    board.setTileValue(point1, 0);
    board.setTileValue(point2, 0);
    return board.grid;
  }

  // 某行(列)在指定方向上可刚性平移的最大格数(该侧连续空格数), 无砖时返回 0
  private shiftRoom(lineIndex: number, direction: Direction): number {
    if (direction.dc !== 0) {
      // 行内水平移动
      const step = direction.dc;
      let edge = step > 0 ? this.cols - 1 : 0;
      let room = 0;
      while (this.grid[lineIndex][edge] === 0) {
        room++;
        edge -= step;
        if (edge < 0 || edge >= this.cols) break;
      }
      // 该行无砖则 room 无意义
      const hasTile = this.grid[lineIndex].some(v => v !== 0);
      return hasTile ? Math.min(room, this.cols - 1) : 0;
    }
    const step = direction.dr;
    let edge = step > 0 ? this.rows - 1 : 0;
    let room = 0;
    while (this.grid[edge][lineIndex] === 0) {
      room++;
      edge -= step;
      if (edge < 0 || edge >= this.rows) break;
    }
    const hasTile = this.grid.some(row => row[lineIndex] !== 0);
    return hasTile ? Math.min(room, this.rows - 1) : 0;
  }

  // 对 lineIndex 行/列整体平移 distance 格(direction 决定轴向), 返回新棋盘与移动后的砖位置
  private rigidShift(lineIndex: number, direction: Direction, distance: number): { grid: number[][]; moved: Coordinate[] } {
    const grid = Array.from({ length: this.rows }, () => new Array<number>(this.cols).fill(0));
    const moved: Coordinate[] = [];
    const horizontal = direction.dc !== 0;
    const d = horizontal ? direction.dc * distance : direction.dr * distance;

    for (let i = 0; i < this.rows; i++) {
      for (let j = 0; j < this.cols; j++) {
        const v = this.grid[i][j];
        if (v === 0) continue;
        if (horizontal && i === lineIndex) {
          grid[i][j + d] = v;
          moved.push({ r: i, c: j + d });
        } else if (!horizontal && j === lineIndex) {
          grid[i + d][j] = v;
          moved.push({ r: i + d, c: j });
        } else {
          grid[i][j] = v;
        }
      }
    }
    return { grid, moved };
  }

  /**
   * 移动后自动结算: 每个被移动过的砖, 在四个方向上找最近非空砖(可隔空格), 同色则成对消除。
   * 每个砖最多参与一对。
   */
  private moveEliminations(grid: number[][], moved: Coordinate[]): EliminateBlock[] {
    const b = new Board(grid);
    const pairs: EliminateBlock[] = [];
    const used = new Set<string>();
    const key = (p: Coordinate) => `${p.r},${p.c}`;

    for (const p of moved) {
      const v = b.getTileValue(p);
      if (v === 0 || used.has(key(p))) continue;
      for (const d of ALL_DIRECTIONS) {
        let q = b.tick(p, d, 1);
        while (q && b.isHoleTile(q)) q = b.tick(q, d, 1);
        if (q && !used.has(key(q)) && b.getTileValue(q) === v) {
          pairs.push({ value: v, point1: { ...p }, point2: { ...q } });
          used.add(key(p));
          used.add(key(q));
          break;
        }
      }
    }
    return pairs;
  }

  // 应用一组消除, 返回最终棋盘
  private applyEliminations(grid: number[][], pairs: EliminateBlock[]): number[][] {
    const out = grid.map(row => [...row]);
    for (const p of pairs) {
      out[p.point1.r][p.point1.c] = 0;
      out[p.point2.r][p.point2.c] = 0;
    }
    return out;
  }

  // 计算一次平移的结果(含自动对消), 返回最终棋盘与消除对; 无消除则返回 null(弹回, 无效移动)
  private tryShift(lineIndex: number, direction: Direction, distance: number): { grid: number[][]; elims: EliminateBlock[] } | null {
    const { grid, moved } = this.rigidShift(lineIndex, direction, distance);
    const elims = this.moveEliminations(grid, moved);
    if (elims.length === 0) return null;
    return { grid: this.applyEliminations(grid, elims), elims };
  }

  /**
   * 找出所有有效移动: 整行/整列刚性平移 k 格且能产生自动对消
   * 沿用 EffectiveMove 结构: tileVector 表示被移动线段(砖块占据范围), direction/distance 表示平移
   */
  findAllEffectiveMoves(): EffectiveMove[] {
    const moves: EffectiveMove[] = [];

    const collect = (lineIndex: number, direction: Direction, horizontal: boolean) => {
      const room = this.shiftRoom(lineIndex, direction);
      // 该线段的砖块占据范围(用于 tileVector 展示)
      let first = -1;
      let last = -1;
      if (horizontal) {
        for (let c = 0; c < this.cols; c++) if (this.grid[lineIndex][c] !== 0) { if (first < 0) first = c; last = c; }
      } else {
        for (let r = 0; r < this.rows; r++) if (this.grid[r][lineIndex] !== 0) { if (first < 0) first = r; last = r; }
      }
      if (first < 0) return;

      for (let k = 1; k <= room; k++) {
        const result = this.tryShift(lineIndex, direction, k);
        if (!result) continue;
        const start = horizontal ? { r: lineIndex, c: first } : { r: first, c: lineIndex };
        const end = horizontal ? { r: lineIndex, c: last } : { r: last, c: lineIndex };
        const tileVector: TileVector = { start, end, direction };
        moves.push({ direction, distance: k, tileVector, eliminate: result.elims[0] });
      }
    };

    for (let r = 0; r < this.rows; r++) {
      collect(r, DIRECTION.LEFT, true);
      collect(r, DIRECTION.RIGHT, true);
    }
    for (let c = 0; c < this.cols; c++) {
      collect(c, DIRECTION.UP, false);
      collect(c, DIRECTION.DOWN, false);
    }
    return moves;
  }

  /**
   * 执行【移动】: 刚性平移 + 自动对消, 返回最终棋盘与移动后的线段位置
   */
  execMove(move: EffectiveMove): [number[][], TileVector] {
    const { tileVector, direction, distance } = move;
    const horizontal = direction.dc !== 0;
    const lineIndex = horizontal ? tileVector.start.r : tileVector.start.c;
    const result = this.tryShift(lineIndex, direction, distance);
    if (!result) {
      console.warn('执行了无效移动(不会产生消除), 弹回');
      return [this.grid.map(row => [...row]), tileVector];
    }
    const movedTileVector: TileVector = {
      start: { r: tileVector.start.r + direction.dr * distance, c: tileVector.start.c + direction.dc * distance },
      end: { r: tileVector.end.r + direction.dr * distance, c: tileVector.end.c + direction.dc * distance },
      direction,
    };
    return [result.grid, movedTileVector];
  }
}
