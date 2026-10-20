// 执行一次系统鼠标拖拽 (参数为截图图像像素坐标, 像素->显示点换算由 C 助手完成)
export default defineEventHandler(async event => {
  const body = await readBody<{
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    imageWidth: number;
    imageHeight: number;
  }>(event);

  const nums = [body?.startX, body?.startY, body?.endX, body?.endY, body?.imageWidth, body?.imageHeight];
  if (nums.some(v => typeof v !== 'number' || !isFinite(v))) {
    throw createError({ statusCode: 400, statusMessage: '拖拽参数无效' });
  }
  if (body.imageWidth <= 0 || body.imageHeight <= 0) {
    throw createError({ statusCode: 400, statusMessage: '图像尺寸无效' });
  }

  try {
    const detail = await execMouseDrag(body);
    return { ok: true, detail };
  } catch (e: any) {
    throw createError({ statusCode: 500, statusMessage: `拖拽执行失败: ${e?.message ?? e}` });
  }
});
