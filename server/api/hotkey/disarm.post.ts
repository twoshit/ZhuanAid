// 停止热键监听进程
import { disarmHotkey } from '../../utils/hotkey';

export default defineEventHandler(() => {
  disarmHotkey();
  return { ok: true };
});
