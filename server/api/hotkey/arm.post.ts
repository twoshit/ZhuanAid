// 启动全局停止热键 (⌘⌥A) 监听
import { armHotkey } from '../../utils/hotkey';

export default defineEventHandler(() => {
  try {
    armHotkey().catch(e => console.error('[hotkey] arm failed:', e?.message ?? e));
    return { ok: true };
  } catch (e: any) {
    throw createError({ statusCode: 500, statusMessage: `热键启动失败: ${e?.message ?? e}` });
  }
});
