// 测试专用: 让 Node 内置测试运行器能解析 Nuxt 的 "~" 别名 (生产代码不依赖此文件)

import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('~/')) {
      const target = join(root, specifier.slice(2));
      for (const ext of ['.ts', '.js', '/index.ts']) {
        if (existsSync(target + ext)) {
          return nextResolve(pathToFileURL(target + ext).href, context);
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
