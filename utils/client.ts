// 当前浏览器是否运行在 Mac 本机 (localhost)
// 依赖本机系统的功能(整屏抓取/窗口抓取/鼠标注入/全局热键)只在本机开放,
// 局域网其他设备仅使用"上传截图识别 + 求解演示"
export function isLocalClient(): boolean {
  if (typeof window === 'undefined') return false;
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(window.location.hostname);
}
