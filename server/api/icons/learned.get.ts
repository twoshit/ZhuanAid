import { promises as fs } from 'node:fs';
import { join } from 'node:path';

// 已学习的新图标 ID 列表 (public/icons 下编号 >= 64 的 png)
export default defineEventHandler(async () => {
  const dir = join(process.cwd(), 'public', 'icons');
  try {
    const files = await fs.readdir(dir);
    const ids = files
      .map(f => Number(f.replace(/\.png$/, '')))
      .filter(n => Number.isInteger(n) && n >= 64);
    return { ids: ids.sort((a, b) => a - b) };
  } catch {
    return { ids: [] };
  }
});
