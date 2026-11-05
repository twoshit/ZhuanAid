// 列出屏幕上的普通窗口 (供选择小程序窗口)
import { listWindows } from '../../utils/winInput';

export default defineEventHandler(async () => {
  try {
    return { windows: await listWindows() };
  } catch (e: any) {
    throw createError({ statusCode: 500, statusMessage: `窗口列表获取失败: ${e?.message ?? e}` });
  }
});
