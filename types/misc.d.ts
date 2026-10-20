export interface BoardRegion {
  id: string;
  name: string;
  // 棋盘区域归一化比例(0~1), 相对截图实际宽高, 裁剪时按图片尺寸自适应换算为像素
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
