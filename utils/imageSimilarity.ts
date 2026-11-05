/**
 * 经典图像相似度特征 (整合自 brick-helper/algorithms.py):
 * - pHash: 32x32 灰度 -> DCT 取 8x8 低频 -> 均值二值化 64bit -> 汉明相似度
 * - 三通道直方图相似度: 各通道 256bin, 逐 bin 相对差比较后取均值
 * 用于神经网络特征匹配失败时的"经典特征救援", 以及学习图标聚类时的防误并校验。
 */

export interface ClassicSig {
  phash: number[]; // 64 个 0/1
  hist: number[][]; // 3 通道 x 256 bin 计数
}

const PHASH_SIZE = 32;
const DCT_KEEP = 8;
const HIST_SIZE = 128; // 直方图比较前统一缩放尺寸
const HIST_BINS = 256;

// 预计算 DCT-II 余弦表: cosTable[u][x] = cos((2x+1)*u*PI/64), u,x in [0,32)
const COS_TABLE: number[][] = (() => {
  const t: number[][] = [];
  for (let u = 0; u < DCT_KEEP; u++) {
    const row: number[] = [];
    for (let x = 0; x < PHASH_SIZE; x++) {
      row.push(Math.cos(((2 * x + 1) * u * Math.PI) / (2 * PHASH_SIZE)));
    }
    t.push(row);
  }
  return t;
})();

// 将任意图源绘制到 size x size 画布并取像素
function drawToPixels(
  src: HTMLImageElement | HTMLCanvasElement,
  size: number
): Uint8ClampedArray {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(src, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size).data;
}

// 计算一张图(或格子裁剪画布)的经典特征签名
export function computeSignature(
  src: HTMLImageElement | HTMLCanvasElement
): ClassicSig {
  // ---- pHash ----
  const grayPx = drawToPixels(src, PHASH_SIZE);
  const gray = new Float64Array(PHASH_SIZE * PHASH_SIZE);
  for (let i = 0; i < PHASH_SIZE * PHASH_SIZE; i++) {
    // OpenCV BGR2GRAY 权重
    gray[i] = 0.299 * grayPx[i * 4] + 0.587 * grayPx[i * 4 + 1] + 0.114 * grayPx[i * 4 + 2];
  }
  // 仅计算 8x8 低频系数: DCT[u][v] = sum_x sum_y f[x][y]*cos_u(x)*cos_v(y)
  const roi: number[] = [];
  for (let u = 0; u < DCT_KEEP; u++) {
    for (let v = 0; v < DCT_KEEP; v++) {
      let sum = 0;
      for (let y = 0; y < PHASH_SIZE; y++) {
        const cy = COS_TABLE[v][y];
        const rowBase = y * PHASH_SIZE;
        for (let x = 0; x < PHASH_SIZE; x++) {
          sum += gray[rowBase + x] * COS_TABLE[u][x] * cy;
        }
      }
      roi.push(sum);
    }
  }
  const avg = roi.reduce((a, b) => a + b, 0) / roi.length;
  const phash = roi.map((v) => (v > avg ? 1 : 0));

  // ---- 三通道直方图 ----
  const px = drawToPixels(src, HIST_SIZE);
  const hist: number[][] = [
    new Array(HIST_BINS).fill(0),
    new Array(HIST_BINS).fill(0),
    new Array(HIST_BINS).fill(0),
  ];
  const n = HIST_SIZE * HIST_SIZE;
  for (let i = 0; i < n; i++) {
    hist[0][px[i * 4]]++;
    hist[1][px[i * 4 + 1]]++;
    hist[2][px[i * 4 + 2]]++;
  }
  return { phash, hist };
}

// pHash 汉明相似度: 1 - 不同位数/64
export function phashSimilarity(a: number[], b: number[]): number {
  let diff = 0;
  for (let i = 0; i < 64; i++) if (a[i] !== b[i]) diff++;
  return 1 - diff / 64;
}

// 单通道直方图相似度 (对齐 brick-helper compare_hist_with_split)
function histChannelSim(h1: number[], h2: number[]): number {
  let degree = 0;
  for (let i = 0; i < HIST_BINS; i++) {
    const a = h1[i];
    const b = h2[i];
    if (a === b) degree += 1;
    else degree += 1 - Math.abs(a - b) / Math.max(a, b);
  }
  return degree / HIST_BINS;
}

// 三通道直方图相似度
export function histSimilarity(a: number[][], b: number[][]): number {
  return (
    (histChannelSim(a[0], b[0]) + histChannelSim(a[1], b[1]) + histChannelSim(a[2], b[2])) / 3
  );
}

// 救援判据阈值 (实测 64 个内置图标 + 形变裁剪标定):
// 同图标的 hist+phash 组合分与相近跨图标分数存在重叠(绝对阈值会误吞新图标),
// 故采用"最高分达标 且 领先次高足够多"的相对判据。
// F=1.3, M=0.1 时: 已知图标召回 47/64, 新图标被误吞 0/64。
export const CLASSIC_MIN_SCORE = 1.3; // 最高组合分下限
export const CLASSIC_MIN_MARGIN = 0.1; // 最高分与次高分的最小差距
