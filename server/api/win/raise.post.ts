// 把目标窗口提到最前 (HID 真实鼠标通道要求游戏窗口为前台)
// 未提供 windowId 时按标题自动查找《砖了个砖》小程序窗口
import { raiseWindow, listWindows } from '../../utils/winInput';

export default defineEventHandler(async event => {
  const body = await readBody<{ windowId?: number }>(event);
  try {
    let id = body?.windowId;
    if (!id) {
      const wins = await listWindows();
      // 必须 owner=微信 且标题含"砖了个砖": 浏览器打开的工具页标题也含该词, 不能误匹配
      const game = wins.find(
        w => w.w > 100 && w.h > 100 && (w.owner === '微信' || w.owner.toLowerCase().includes('wechat')) && w.title.includes('砖了个砖')
      );
      if (!game) {
        throw createError({ statusCode: 404, statusMessage: '未找到《砖了个砖》窗口, 请手动选择窗口或把游戏置于前台' });
      }
      id = game.windowId;
    }
    await raiseWindow(id);
    return { ok: true, windowId: id };
  } catch (e: any) {
    if (e?.statusCode) throw e;
    throw createError({ statusCode: 500, statusMessage: `窗口前置失败: ${e?.message ?? e}` });
  }
});
