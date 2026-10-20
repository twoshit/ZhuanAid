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

// 在二值掩码上找最大的若干 8-连通域包围盒 (屏幕抓取模式用)
function topComponentBBoxes(
  mask: Uint8Array,
  sw: number,
  sh: number,
  k: number
): { x0: number; y0: number; x1: number; y1: number; count: number }[] {
  const label = new Int32Array(sw * sh).fill(-1);
  const comps: { x0: number; y0: number; x1: number; y1: number; count: number }[] = [];
  const queue = new Int32Array(sw * sh);
  let nextId = 1;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || label[i] >= 0) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = i;
    label[i] = nextId;
    let x0 = sw,
      y0 = sh,
      x1 = -1,
      y1 = -1,
      count = 0;
    while (head < tail) {
      const p = queue[head++];
      const py = (p / sw) | 0;
      const px = p - py * sw;
      count++;
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = px + dx;
          const ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= sw || ny >= sh) continue;
          const n = ny * sw + nx;
          if (mask[n] && label[n] < 0) {
            label[n] = nextId;
            queue[tail++] = n;
          }
        }
      }
    }
    nextId++;
    comps.push({ x0, y0, x1, y1, count });
  }
  return comps.sort((a, b) => b.count - a.count).slice(0, k);
}

export interface DetectBoardOptions {
  // 棋盘面积占图像最小比例 (上传截图默认 0.15; 屏幕抓取建议 0.02)
  minAreaRatio?: number;
  // 屏幕抓取模式: 全屏中游戏窗口占比小, 先定位最大木框连通域再在域内做环带分析
  screenMode?: boolean;
}

/**
 * 自动检测截图中棋盘内部网格区域(自适应任意分辨率/机型)
 *
 * 原理: 棋盘由浅棕色木框环包围, 环的四条边带在降采样图像的行/列颜色覆盖率
 * 曲线上各形成一个高覆盖窄带; 上下左右第一个/最后一个窄带的内边缘即为网格边界。
 *
 * 屏幕抓取模式(screenMode): 游戏窗口只占全屏一小部分, 绝对覆盖率阈值失效;
 * 改为先找木框环的最大连通域包围盒, 在盒内按盒尺寸归一化后沿用同一环带算法。
 */
export async function detectBoardRegion(
  file: File,
  rows: number,
  cols: number,
  opts: DetectBoardOptions = {}
): Promise<BoardRegion | null> {
  const { minAreaRatio = 0.15, screenMode = false } = opts;
  const img = await loadImage(URL.createObjectURL(file));
  const { width: W, height: H } = img;

  // 降采样加速分析; 屏幕模式用高分辨率, 避免全屏中小窗口的细木框被平均掉
  const sw = screenMode ? Math.min(W, 3000) : 400;
  const sh = Math.max(1, Math.round((H * sw) / W));
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, sw, sh);
  const data = ctx.getImageData(0, 0, sw, sh).data;

  const mask = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i = (y * sw + x) * 4;
      if (isRing(data[i], data[i + 1], data[i + 2])) mask[y * sw + x] = 1;
    }
  }

  // 在给定分析窗口内做环带分析, 通过合理性校验则返回归一化区域
  function analyzeWindow(
    ax0: number,
    ay0: number,
    ax1: number,
    ay1: number
  ): BoardRegion | null {
    const bw = ax1 - ax0 + 1;
    const bh = ay1 - ay0 + 1;
    const rowHits = new Array<number>(bh).fill(0);
    const colHits = new Array<number>(bw).fill(0);
    for (let y = ay0; y <= ay1; y++) {
      for (let x = ax0; x <= ax1; x++) {
        if (mask[y * sw + x]) {
          rowHits[y - ay0]++;
          colHits[x - ax0]++;
        }
      }
    }

    const rowBands = findBands(rowHits.map(v => v / bw), 0.5);
    const colBands = findBands(colHits.map(v => v / bh), 0.5);
    if (rowBands.length < 2 || colBands.length < 2) return null;

    const sx = W / sw;
    const sy = H / sh;
    const x0 = (ax0 + colBands[0][1] + 1) * sx; // 左边带内边缘
    const x1 = (ax0 + colBands[colBands.length - 1][0]) * sx; // 右边带内边缘
    const y0 = (ay0 + rowBands[0][1] + 1) * sy; // 上边带内边缘
    const y1 = (ay0 + rowBands[rowBands.length - 1][0]) * sy; // 下边带内边缘

    // 合理性校验: 尺寸为正、面积足够大、宽高比接近 rows/cols 网格
    const gw = x1 - x0;
    const gh = y1 - y0;
    const expectedRatio = cols / rows;
    const ratioTolerance = screenMode ? 0.5 : 0.25;
    if (gw <= 0 || gh <= 0 || gw * gh < W * H * minAreaRatio || Math.abs(gw / gh / expectedRatio - 1) > ratioTolerance) {
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

  if (!screenMode) {
    const region = analyzeWindow(0, 0, sw - 1, sh - 1);
    if (!region) console.warn('棋盘检测失败: 未找到合理的木框环');
    return region;
  }

  // 屏幕模式: 壁纸/其他窗口也含棕色, 木框不一定是最大连通域;
  // 依次尝试最大的若干连通域包围盒, 取第一个通过校验的
  const comps = topComponentBBoxes(mask, sw, sh, 25).filter(
    c => c.count >= 60 && c.x1 - c.x0 >= 20 && c.y1 - c.y0 >= 20
  );
  for (const comp of comps) {
    const region = analyzeWindow(comp.x0, comp.y0, comp.x1, comp.y1);
    if (region) return region;
  }
  console.warn(
    '棋盘检测失败(屏幕模式): 候选连通域均不合理 ' +
      JSON.stringify(
        comps.slice(0, 5).map(c => ({ x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1, count: c.count }))
      )
  );
  return null;
}
