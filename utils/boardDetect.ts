import type { BoardRegion } from '~/types/misc';
import { loadImage } from '~/utils/helper';

// 棋盘木框环的浅棕色 (约 RGB 188,131,50)
function isRing(r: number, g: number, b: number): boolean {
  return r >= 158 && r <= 228 && g >= 98 && g <= 162 && b >= 15 && b <= 90 && r - g > 35 && g - b > 35;
}

// 在连续段列表中取覆盖率高(>=2)的第一段与最后一段(即木框环的上/下、左/右边带)
function findBands(profile: number[], threshold: number): [number, number][] {
  const bands: [number, number][] = [];
  let start: number | null = null;
  for (let i = 0; i < profile.length; i++) {
    if (profile[i] > threshold) {
      if (start === null) start = i;
    } else if (start !== null) {
      bands.push([start, i - 1]);
      start = null;
    }
  }
  if (start !== null) bands.push([start, profile.length - 1]);
  return bands;
}

/**
 * 自动检测截图中棋盘内部网格区域(自适应任意分辨率/机型)
 *
 * 原理: 棋盘由浅棕色木框环包围, 环的四条边带在降采样图像的行/列颜色覆盖率
 * 曲线上各形成一个高覆盖窄带; 上下左右第一个/最后一个窄带的内边缘即为网格边界。
 *
 * @returns 归一化区域(0~1), 检测失败返回 null
 */
export async function detectBoardRegion(file: File, rows: number, cols: number): Promise<BoardRegion | null> {
  const img = await loadImage(URL.createObjectURL(file));
  const { width: W, height: H } = img;

  // 降采样加速分析
  const sw = 400;
  const sh = Math.max(1, Math.round((H * sw) / W));
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, sw, sh);
  const data = ctx.getImageData(0, 0, sw, sh).data;

  const rowHits = new Array<number>(sh).fill(0);
  const colHits = new Array<number>(sw).fill(0);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i = (y * sw + x) * 4;
      if (isRing(data[i], data[i + 1], data[i + 2])) {
        rowHits[y]++;
        colHits[x]++;
      }
    }
  }

  const rowBands = findBands(rowHits.map(v => v / sw), 0.5);
  const colBands = findBands(colHits.map(v => v / sh), 0.5);
  if (rowBands.length < 2 || colBands.length < 2) {
    console.warn('棋盘检测失败: 未找到完整的木框环', { rowBands, colBands });
    return null;
  }

  const sx = W / sw;
  const sy = H / sh;
  const x0 = (colBands[0][1] + 1) * sx; // 左边带内边缘
  const x1 = colBands[colBands.length - 1][0] * sx; // 右边带内边缘
  const y0 = (rowBands[0][1] + 1) * sy; // 上边带内边缘
  const y1 = rowBands[rowBands.length - 1][0] * sy; // 下边带内边缘

  // 合理性校验: 尺寸为正、面积足够大、宽高比接近 rows/cols 网格
  const gw = x1 - x0;
  const gh = y1 - y0;
  const expectedRatio = cols / rows;
  if (gw <= 0 || gh <= 0 || gw * gh < W * H * 0.15 || Math.abs(gw / gh / expectedRatio - 1) > 0.25) {
    console.warn('棋盘检测失败: 结果不合理', { gw, gh, ratio: gw / gh, expectedRatio });
    return null;
  }

  return {
    id: 'auto',
    name: '自动检测',
    x1: x0 / W,
    y1: y0 / H,
    x2: x1 / W,
    y2: y1 / H,
  };
}
