import type { BoardRegion } from '~/types/misc';

/**
 * 是否在开发环境
 */
export const isDev = process.env.NODE_ENV === 'development';

/**
 * 网站标题
 */
export const websiteName = '《砖了个砖》游戏辅助';

// 64个分类，0表示空
export const NUM_CLASSES = 64;

// 棋盘裁剪区域预设(归一化比例, 相对截图宽高)
// 裁剪时按截图实际分辨率换算为像素, 因此任意分辨率截图均可自适应识别
export const BOARD_REGIONS: BoardRegion[] = [
  {
    id: 'iphone-11-pro',
    name: 'iPhone 11 Pro',
    x1: 35 / 1125,
    y1: 580 / 2436,
    x2: 1090 / 1125,
    y2: 2070 / 2436,
  },
  {
    id: 'iphone-17-pro',
    name: 'iPhone 17 Pro',
    x1: 37 / 1206,
    y1: 626 / 2622,
    x2: 1170 / 1206,
    y2: 2222 / 2622,
  },
];
