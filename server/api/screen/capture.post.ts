// 抓取 Mac 主显示器屏幕, 返回 PNG base64 与像素尺寸
export default defineEventHandler(async () => {
  try {
    const buf = await captureScreenPng();
    const header = parsePngHeader(buf);
    if (!header) throw new Error('无法识别截图 PNG 格式');
    return { base64: buf.toString('base64'), width: header.width, height: header.height };
  } catch (e: any) {
    throw createError({
      statusCode: 500,
      statusMessage: `屏幕抓取失败: ${e?.message ?? e}`,
    });
  }
});
