import * as tf from '@tensorflow/tfjs';
import { NUM_CLASSES } from '~/config';
import { cosineSimilarity, loadImage } from '~/utils/helper';

const MODEL_URL = 'https://www.kaggle.com/models/google/mobilenet-v2/TfJs/035-128-feature-vector/3';
const INPUT_NAME = 'images'; // 模型输入键
const INPUT_SHAPE: [number, number] = [128, 128]; // 128x128
const ICON_PATH = '/icons/'; // 图标路径
const SIM = 0.6; // 相似度阈值

let prototypes: any[] = []; // 每个分类的原型向量
let sharedModel: any = null; // 共享模型实例

export class BoardParser {
  private callback?: (status: string) => void;

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
      for (let i = 0; i < NUM_CLASSES; i++) {
        try {
          const img = await loadImage(`${ICON_PATH}${i}.png`);
          const tensor = tf.browser
            .fromPixels(img)
            .resizeNearestNeighbor(INPUT_SHAPE)
            .toFloat()
            .div(255.0) // 归一化 [0,1]
            .expandDims();
          const output = sharedModel.execute({ [INPUT_NAME]: tensor });
          const features = await output.data();
          prototypes.push(Array.from(features));
          tensor.dispose();
          output.dispose();
        } catch (e: any) {
          console.warn(`图标 ${i}.png 未找到，跳过: ${e.message}`);
          prototypes.push(null);
        }
      }
    } catch (e: any) {
      console.warn(`模型加载失败: ${e.message}\n请检查网络或URL。`);
      throw e;
    }
  }

  public async parse(file: File, rows: number, cols: number) {
    // 加载原型（只需一次）
    if (prototypes.length === 0) {
      await this.loadPrototypes();
    }

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
    for (let row = 0; row < rows; row++) {
      grid[row] = [];
      for (let col = 0; col < cols; col++) {
        // 裁剪格子（中心裁剪）
        const x = 30 + col * cellWidth;
        const y = 30 + row * cellHeight;
        const cropX = Math.max(0, x + (cellWidth - cellSize) / 2);
        const cropY = Math.max(0, y + (cellHeight - cellSize) / 2);

        // 对格子区域提取特征并分类; inset 为中心内缩比例
        const classify = async (inset: number): Promise<number> => {
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
          const cellFeatures: number[] = Array.from(await output.data());
          tensor.dispose();
          output.dispose();

          let bestClass = -1;
          let bestSim = -1;
          for (let idx = 0; idx < NUM_CLASSES; idx++) {
            if (prototypes[idx] === null) continue;
            const sim = cosineSimilarity(cellFeatures, prototypes[idx]);
            if (sim > bestSim) {
              bestSim = sim;
              bestClass = idx;
            }
          }
          return bestSim > SIM ? bestClass : -1;
        };

        let bestClass = await classify(0);
        // 区域对齐偏差会让邻砖边缘混入格子导致匹配失败: 逐级内缩重试
        for (const inset of [0.06, 0.12, 0.2]) {
          if (bestClass !== -1) break;
          bestClass = await classify(inset);
        }
        if (bestClass === -1) {
          console.warn(`(${row + 1}, ${col + 1}) 所有内缩级别均匹配失败`);
        }

        grid[row][col] = bestClass;
      }
    }

    return grid;
  }
}
