// 最小 PNG 解析工具（无外部依赖, 仅用于屏幕截图头信息读取与纯色检测）
import { inflateSync } from 'node:zlib';

export interface PngHeader {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace: number;
}

export function parsePngHeader(buf: Buffer): PngHeader | null {
  if (buf.length < 29 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bitDepth: buf[24],
    colorType: buf[25],
    interlace: buf[28],
  };
}

export interface PngPixels {
  width: number;
  height: number;
  channels: number;
  data: Buffer;
}

// 解码 8bit 非隔行 RGB/RGBA PNG 为原始像素; 其他格式返回 null
export function decodePngPixels(buf: Buffer): PngPixels | null {
  const h = parsePngHeader(buf);
  if (!h || h.bitDepth !== 8 || h.interlace !== 0 || (h.colorType !== 2 && h.colorType !== 6)) return null;

  let off = 8;
  const parts: Buffer[] = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'IDAT') parts.push(buf.subarray(off + 8, off + 8 + len));
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (parts.length === 0) return null;

  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(parts));
  } catch {
    return null;
  }

  const channels = h.colorType === 6 ? 4 : 3;
  const stride = h.width * channels;
  const out = Buffer.alloc(h.height * stride);
  let pos = 0;
  for (let y = 0; y < h.height; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - 1] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - 1] : 0;
      const v = line[x];
      switch (filter) {
        case 0:
          cur[x] = v;
          break;
        case 1:
          cur[x] = (v + a) & 255;
          break;
        case 2:
          cur[x] = (v + b) & 255;
          break;
        case 3:
          cur[x] = (v + ((a + b) >> 1)) & 255;
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          cur[x] = (v + pr) & 255;
          break;
        }
        default:
          return null;
      }
    }
  }
  return { width: h.width, height: h.height, channels, data: out };
}

// 采样判断图像是否纯色/近黑 (screencapture 被"屏幕录制"权限拦截时的典型表现)
export function isSolidImage(px: PngPixels): boolean {
  const { width, height, channels, data } = px;
  const seen = new Set<number>();
  let sum = 0;
  let n = 0;
  const step = Math.max(1, Math.floor(Math.min(width, height) / 64));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * channels;
      if (seen.size < 16) seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
      sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
      n++;
    }
  }
  return seen.size <= 2 || sum / Math.max(1, n) < 3;
}
