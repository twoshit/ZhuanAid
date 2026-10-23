// 向指定窗口进程后台投递拖拽 (像素坐标为该窗口截图的像素空间)
import { winDrag } from '../../utils/winInput';

export default defineEventHandler(async event => {
  const body = await readBody<{
    windowId: number;
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    imageWidth: number;
    imageHeight: number;
  }>(event);
  const nums = [body?.startX, body?.startY, body?.endX, body?.endY, body?.imageWidth, body?.imageHeight];
  if (!body?.windowId || nums.some(v => typeof v !== 'number' || !isFinite(v))) {
    throw createError({ statusCode: 400, statusMessage: '拖拽参数无效' });
  }
  try {
    return { ok: true, detail: await winDrag(body) };
  } catch (e: any) {
    throw createError({ statusCode: 500, statusMessage: `窗口拖拽失败: ${e?.message ?? e}` });
  }
});
