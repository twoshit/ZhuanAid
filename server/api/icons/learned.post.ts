import { promises as fs } from 'node:fs';
import { join } from 'node:path';

// 保存一个新学习的图标: 自动分配下一个编号, 写入 public/icons/<id>.png
// 同一图标去重: 若与已学习图标字节完全一致则返回既有 ID
export default defineEventHandler(async event => {
  const { base64 } = await readBody<{ base64: string }>(event);
  if (!base64 || typeof base64 !== 'string') {
    throw createError({ statusCode: 400, statusMessage: '缺少 base64 图标数据' });
  }
  const dir = join(process.cwd(), 'public', 'icons');
  const buf = Buffer.from(base64.replace(/^data:image\/png;base64,/, ''), 'base64');
  const files = await fs.readdir(dir);
  let maxId = -1;
  const existing = new Set<string>();
  for (const f of files) {
    const n = Number(f.replace(/\.png$/, ''));
    if (Number.isInteger(n)) {
      maxId = Math.max(maxId, n);
      existing.add(f);
    }
  }
  // 去重: 与任一已学习图标内容相同则复用
  for (let id = 64; id <= maxId; id++) {
    try {
      const old = await fs.readFile(join(dir, `${id}.png`));
      if (old.equals(buf)) return { id, reused: true };
    } catch {
      /* 文件不存在则跳过 */
    }
  }
  const id = Math.max(maxId + 1, 64);
  if (existing.has(`${id}.png`)) throw createError({ statusCode: 500, statusMessage: '图标编号冲突' });
  await fs.writeFile(join(dir, `${id}.png`), buf);
  return { id, reused: false };
});
