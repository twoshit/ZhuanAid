export type DirectionName = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

export interface Direction {
  dr: number;
  dc: number;
  name: DirectionName;
}

export interface Coordinate {
  r: number;
  c: number;
}

export interface EliminateBlock {
  point1: Coordinate;
  point2: Coordinate;
  value: number;
}

export interface TileVector {
  start: Coordinate;
  end: Coordinate;
  direction: Direction;
}

export interface MaximumMove {
  direction: Direction;
  distance: number;
  tileVector: TileVector;
}

export interface EffectiveMove extends MaximumMove {
  eliminate: EliminateBlock;
}

export interface EliminatePointPosition extends Coordinate {
  offset: number;
}

export interface HighLightArea {
  point1: Coordinate;
  point2: Coordinate;
}

// 步骤回放的单步记录
export interface ReplayStep {
  // 步骤类型: 移动后消除 / 立即消除
  type: 'move' | 'eliminate';
  // 执行该步骤后的棋盘快照
  grid: number[][];
  // 该步骤对应的高亮区域
  area: HighLightArea;
  // 涉及的方块图标值
  value: number;
}
