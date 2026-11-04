// 清零热键触发标志 (每轮自动执行开始前调用)
import { resetHotkey } from '../../utils/hotkey';

export default defineEventHandler(() => {
  resetHotkey();
  return { ok: true };
});
