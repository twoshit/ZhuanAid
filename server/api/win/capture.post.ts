// 截取指定窗口 (后台抓取, 无需前台)
import { captureWindow } from '../../utils/winInput';

export default defineEventHandler(async event => {
  const body = await readBody<{ windowId: number }>(event);
  if (!body?.windowId) {
    throw createError({ statusCode: 400, statusMessage: '缺少 windowId' });
  }
  try {
    return await captureWindow(body.windowId);
  } catch (e: any) {
    throw createError({ statusCode: 500, statusMessage: `窗口截图失败: ${e?.message ?? e}` });
  }
});
