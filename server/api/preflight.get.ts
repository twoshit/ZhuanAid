// 环境自检: 屏幕抓取可用性 / 屏幕录制权限(图像是否纯色) / clang 鼠标助手编译
export default defineEventHandler(async () => {
  const result = {
    screencapture: false,
    screenRecording: false,
    dragBinary: false,
    messages: [] as string[],
  };

  try {
    const buf = await captureScreenPng();
    result.screencapture = true;
    const px = decodePngPixels(buf);
    if (px) {
      result.screenRecording = !isSolidImage(px);
      if (!result.screenRecording) {
        result.messages.push('截图为纯色/黑屏, 很可能缺少"屏幕录制"权限');
      }
    } else {
      // 格式无法解码, 保守放行, 由用户在实际抓取后肉眼确认
      result.screenRecording = true;
    }
  } catch (e: any) {
    result.messages.push(`screencapture 不可用: ${e?.message ?? e}`);
  }

  try {
    await ensureMouseBinary();
    result.dragBinary = true;
  } catch (e: any) {
    result.messages.push(`鼠标拖拽助手编译失败: ${e?.message ?? e}`);
  }

  return result;
});
