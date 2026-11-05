import * as tf from '@tensorflow/tfjs';
import { NUM_CLASSES } from '~/config';
import { cosineSimilarity, loadImage } from '~/utils/helper';
import {
  computeSignature,
  histSimilarity,
  phashSimilarity,
  CLASSIC_MIN_SCORE,
  CLASSIC_MIN_MARGIN,
  type ClassicSig,
} from '~/utils/imageSimilarity';

const MODEL_URL = 'https://www.kaggle.com/models/google/mobilenet-v2/TfJs/035-128-feature-vector/3';
const INPUT_NAME = 'images'; // 模型输入键
const INPUT_SHAPE: [number, number] = [128, 128]; // 128x128
const ICON_PATH = '/icons/'; // 图标路径
const SIM = 0.7; // 相似度阈值 (0.6 时新形状易被相似旧类吸收, 实测真实截图在 0.7 下仍全量匹配)
const LEARN_MIN_SIM = 0.82; // 未知格聚为同一新图标的相似度门槛

let prototypes: any[] = []; // 每个分类的原型向量 (下标即类别 ID, 含学习图标)
let classicSigs: (ClassicSig | null)[] = []; // 与 prototypes 对齐的经典特征签名 (pHash + 直方图)
let sharedModel: any = null; // 共享模型实例
let loadedLearned: number[] = []; // 已载入原型库的学习图标 ID

// 提取一张图片的特征向量
async function imageFeatures(img: HTMLImageElement): Promise<number[]> {
  const tensor = tf.browser
    .fromPixels(img)
    .resizeNearestNeighbor(INPUT_SHAPE)
    .toFloat()
    .div(255.0) // 归一化 [0,1]
    .expandDims();
  const output = sharedModel.execute({ [INPUT_NAME]: tensor });
  const features = Array.from(await output.data());
  tensor.dispose();
  output.dispose();
  return features as number[];
}

// 向服务端查询已学习图标, 增量载入其原型向量
async function syncLearnedPrototypes(notify?: (s: string) => void) {
  try {
    const { ids } = await $fetch<{ ids: number[] }>('/api/icons/learned');
    for (const id of ids) {
      if (loadedLearned.includes(id)) continue;
      try {
        const img = await loadImage(`${ICON_PATH}${id}.png`);
        prototypes[id] = await imageFeatures(img);
        classicSigs[id] = computeSignature(img);
        loadedLearned.push(id);
      } catch (e: any) {
        console.warn(`学习图标 ${id}.png 加载失败: ${e.message}`);
      }
    }
    if (notify && loadedLearned.length) notify(`原型库: ${ids.length} 个学习图标`);
  } catch {
    /* 服务端不可用时仅用内置图标 */
  }
}

export class BoardParser {
  private callback?: (status: string) => void;
  // 本次 parse 中新学习到的图标 ID
  lastLearned: number[] = [];

  constructor(callback?: (status: string) => void) {
    this.callback = callback;
  }

  private notify(status: string): void {
    if (typeof this.callback === 'function') {
      this.callback(status);
    }
  }

  private async loadPrototypes() {
    try {
      if (sharedModel === null) {
        this.notify('加载模型中');
        sharedModel = await tf.loadGraphModel(MODEL_URL, { fromTFHub: true });
      }

      this.notify('加载原型中');
      prototypes = [];
      classicSigs = [];
      for (let i = 0; i < NUM_CLASSES; i++) {
        try {
          const img = await loadImage(`${ICON_PATH}${i}.png`);
          prototypes[i] = await imageFeatures(img);
          classicSigs[i] = computeSignature(img);
        } catch (e: any) {
          console.warn(`图标 ${i}.png 未找到，跳过: ${e.message}`);
          prototypes[i] = null;
          classicSigs[i] = null;
        }
      }
      // 载入历史学习的新图标
      await syncLearnedPrototypes();
    } catch (e: any) {
      console.warn(`模型加载失败: ${e.message}\n请检查网络或URL。`);
      throw e;
    }
  }

  public async parse(file: File, rows: number, cols: number) {
    // 加载原型（只需一次）; 已有原型库时增量同步其他端学习的新图标
    if (prototypes.length === 0) {
      await this.loadPrototypes();
    } else {
      await syncLearnedPrototypes();
    }
    this.lastLearned = [];

    this.notify('提取网格中');
    const img = await loadImage(URL.createObjectURL(file));

    // 动态调整Canvas大小
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    const aspectRatio = img.width / img.height;
    const maxWidth = 1200;
    let displayWidth = Math.min(img.width, maxWidth);
    let displayHeight = displayWidth / aspectRatio;
    if (displayHeight > 800) {
      displayHeight = 800;
      displayWidth = displayHeight * aspectRatio;
    }
    canvas.width = displayWidth + 30 * 2; // 两边需要加上行列序号
    canvas.height = displayHeight + 30 * 2; // 上下也需要加上行列序号
    // canvas.style.display = 'block';
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 30, 30, displayWidth, displayHeight);

    // 动态计算每个格子大小
    const cellWidth = displayWidth / cols;
    const cellHeight = displayHeight / rows;
    const cellSize = Math.min(cellWidth, cellHeight);

    // 提取网格
    const grid: number[][] = [];
    // 所有原型均不匹配的格子: 特征+裁剪图, 网格扫完后聚类学习为新图标
    const unknowns: {
      r: number;
      c: number;
      best: number;
      features: number[];
      png: string;
      sig: ClassicSig;
    }[] = [];
    for (let row = 0; row < rows; row++) {
      grid[row] = [];
      for (let col = 0; col < cols; col++) {
        // 裁剪格子（中心裁剪）
        const x = 30 + col * cellWidth;
        const y = 30 + row * cellHeight;
        const cropX = Math.max(0, x + (cellWidth - cellSize) / 2);
        const cropY = Math.max(0, y + (cellHeight - cellSize) / 2);

        // 对格子区域提取特征并分类; inset 为中心内缩比例
        const classify = async (inset: number, wantPng = false) => {
          const shrink = cellSize * inset;
          const sx = cropX + shrink / 2;
          const sy = cropY + shrink / 2;
          const sw = cellSize - shrink;
          const cellCanvas = document.createElement('canvas');
          cellCanvas.width = cellSize;
          cellCanvas.height = cellSize;
          const cellCtx = cellCanvas.getContext('2d')!;
          cellCtx.drawImage(canvas, sx, sy, sw, sw, 0, 0, cellSize, cellSize);

          const tensor = tf.browser
            .fromPixels(cellCanvas)
            .resizeNearestNeighbor(INPUT_SHAPE)
            .toFloat()
            .div(255.0)
            .expandDims();
          const output = sharedModel.execute({ [INPUT_NAME]: tensor });
          const features: number[] = Array.from(await output.data());
          tensor.dispose();
          output.dispose();

          let bestClass = -1;
          let bestSim = -1;
          for (let idx = 0; idx < prototypes.length; idx++) {
            if (!prototypes[idx]) continue;
            const sim = cosineSimilarity(features, prototypes[idx]);
            if (sim > bestSim) {
              bestSim = sim;
              bestClass = idx;
            }
          }
          const cls = bestSim > SIM ? bestClass : -1;
          // 最终仍失败时保留裁剪图, 供学习新图标; 同时计算经典特征用于救援/聚类校验
          const want = wantPng && cls === -1;
          const png = want ? cellCanvas.toDataURL('image/png') : '';
          const sig = want ? computeSignature(cellCanvas) : null;
          return { cls, best: bestClass, features, png, sig };
        };

        let res = await classify(0);
        // 区域对齐偏差会让邻砖边缘混入格子导致匹配失败: 逐级内缩重试
        for (const inset of [0.06, 0.12, 0.2]) {
          if (res.cls !== -1) break;
          res = await classify(inset, true);
        }
        if (res.cls === -1) {
          // 经典特征救援: 神经网络全 inset 失败后, 用 pHash + 直方图与所有原型比对。
          // 采用相对判据(最高分达标且明显领先次高), 避免把真正的新图标误吞为相近已知类。
          let rescued = -1;
          let rescuedScore = -1;
          let rescuedMargin = -1;
          if (res.sig) {
            const scored: { idx: number; score: number }[] = [];
            for (let idx = 0; idx < prototypes.length; idx++) {
              const ps = classicSigs[idx];
              if (!prototypes[idx] || !ps) continue;
              const hist = histSimilarity(res.sig.hist, ps.hist);
              const phash = phashSimilarity(res.sig.phash, ps.phash);
              scored.push({ idx, score: hist + phash });
            }
            scored.sort((a, b) => b.score - a.score);
            const best = scored[0];
            const second = scored[1] ? scored[1].score : -Infinity;
            if (best && best.score >= CLASSIC_MIN_SCORE && best.score - second >= CLASSIC_MIN_MARGIN) {
              rescued = best.idx;
              rescuedScore = best.score;
              rescuedMargin = best.score - second;
            }
          }
          if (rescued >= 0) {
            grid[row][col] = rescued;
            console.log(
              `[CLASSIC] R${row + 1}C${col + 1} 经典特征救援为 #${rescued} (score=${rescuedScore.toFixed(3)}, margin=${rescuedMargin.toFixed(3)})`
            );
          } else {
            unknowns.push({
              r: row,
              c: col,
              best: res.best,
              features: res.features,
              png: res.png,
              sig: res.sig!,
            });
            grid[row][col] = -1; // 学习成功后会被替换为新编号
          }
        } else {
          grid[row][col] = res.cls;
        }
      }
    }

    // 未知格聚类 -> 登记为新图标 (同形状互相似度 >= LEARN_MIN_SIM 归为一类)
    if (unknowns.length > 0) {
      this.notify(`发现 ${unknowns.length} 个未知图标, 正在学习…`);
      interface Cluster {
        features: number[];
        png: string;
        sig: ClassicSig;
        cells: [number, number][];
      }
      const clusters: Cluster[] = [];
      for (const u of unknowns) {
        if (!u.png || !u.sig) continue; // 无裁剪图的失败格(理论极少)只能放弃
        let hit: Cluster | null = null;
        for (const cl of clusters) {
          // 聚类同时要求神经网络特征余弦 >= LEARN_MIN_SIM 且 pHash 相似度 >= 0.8
          // 防止把两个视觉上不同的新图标误并成一类
          const phSim = phashSimilarity(u.sig.phash, cl.sig.phash);
          if (cosineSimilarity(u.features, cl.features) >= LEARN_MIN_SIM && phSim >= 0.8) {
            hit = cl;
            break;
          }
        }
        if (hit) {
          hit.cells.push([u.r, u.c]);
          if (!hit.png) hit.png = u.png;
        } else {
          clusters.push({ features: u.features, png: u.png, sig: u.sig, cells: [[u.r, u.c]] });
        }
      }
      for (const cl of clusters) {
        // 防污染: 真实游戏中每种图标至少出现 2 块; 仅 1 格的未知簇多为已知图标的偶发低分, 不登记
        if (cl.cells.length < 2) {
          console.warn(`[LEARN] 跳过孤立未知格 R${cl.cells[0][0] + 1}C${cl.cells[0][1] + 1} (疑似已知图标低分, 不登记)`);
          continue;
        }
        try {
          const { id } = await $fetch<{ id: number }>('/api/icons/learned', {
            method: 'POST',
            body: { base64: cl.png },
          });
          prototypes[id] = cl.features; // 特征即该图标原型, 本次与后续解析均可复用
          classicSigs[id] = cl.sig; // 经典签名同步登记, 供后续救援/聚类使用
          if (!loadedLearned.includes(id)) loadedLearned.push(id);
          for (const [r, c] of cl.cells) grid[r][c] = id;
          this.lastLearned.push(id);
          console.log(`[LEARN] 新图标 #${id}: ${cl.cells.length} 格`);
        } catch (e: any) {
          console.warn('学习图标保存失败:', e?.message ?? e);
        }
      }
      if (this.lastLearned.length > 0) {
        this.notify(`已自动学习 ${this.lastLearned.length} 个新图标 (#${this.lastLearned.join(' #')})`);
      }

      // 奇偶救援: 游戏中每种图标出现次数必为偶数(2或4)。学习阶段结束后,
      // 若某孤立失败格的最近似类 X 在盘内已匹配数为奇数, 几乎可断定本格就是 X(低分漏配), 直接补上;
      // 若 X 为偶数则本格可能是与 X 相似的其他图标/新图标落单, 维持失败不误补。
      const counts = new Map<number, number>();
      for (const rowArr of grid) for (const v of rowArr) if (v >= 0) counts.set(v, (counts.get(v) ?? 0) + 1);
      let rescued = 0;
      for (const u of unknowns) {
        if (grid[u.r][u.c] !== -1) continue; // 已被学习补上
        if (u.best < 0) continue;
        if (((counts.get(u.best) ?? 0) & 1) === 1) {
          grid[u.r][u.c] = u.best;
          counts.set(u.best, (counts.get(u.best) ?? 0) + 1);
          rescued++;
          console.log(`[PARITY] R${u.r + 1}C${u.c + 1} 按奇偶规则补为已知类 #${u.best}`);
        }
      }
      // 收尾: 明确剩余失败状态, 避免界面停留在"正在学习…"
      const left = grid.reduce((n, rowArr) => n + rowArr.filter(v => v < 0).length, 0);
      if (left > 0) this.notify(`识别完成: ${left} 格无法匹配 (已尝试学习/奇偶救援)`);
      else if (rescued > 0) this.notify(`识别完成: ${rescued} 格按奇偶规则自动补全`);
    }

    return grid;
  }
}
