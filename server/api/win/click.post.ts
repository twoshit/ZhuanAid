// 向指定窗口进程后台投递点击 (点消操作用)
import { winClick } from '../../utils/winInput';

export default defineEventHandler(async event => {
  const body = await readBody<{
    windowId: number;
    x: number;
    y: number;
    imageWidth: number;
    imageHeight: number;
  }>(event);
  const nums = [body?.x, body?.y, body?.imageWidth, body?.imageHeight];
  if (!body?.windowId || nums.some(v => typeof v !== 'number' || !isFinite(v))) {
    throw createError({ statusCode: 400, statusMessage: '点击参数无效' });
  }
  try {
    return { ok: true, detail: await winClick(body) };
  } catch (e: any) {
    throw createError({ statusCode: 500, statusMessage: `窗口点击失败: ${e?.message ?? e}` });
  }
});
