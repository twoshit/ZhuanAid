// wininput.c — 窗口级后台输入助手 (不占用物理鼠标)
//
// 用法:
//   wininput list                          列出屏幕上所有窗口:
//                                          windowID \t pid \t 所属进程 \t 标题 \t x y w h
//   wininput bounds <windowID>             输出指定窗口: pid x y w h
//   wininput click <pid> <x> <y>           向目标进程投递左键点击 (全局显示点坐标)
//   wininput drag <pid> <sx> <sy> <ex> <ey> [steps] [delayMs]
//                                          向目标进程投递拖拽 (默认 20 步 / 每步 16ms)
//
// 原理: CGEventPostToPid 把事件直接投递给目标进程的事件队列,
//       物理光标保持原位, 用户可同时操作其他应用。
#include <ApplicationServices/ApplicationServices.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static void printWindows(pid_t onlyId, int boundsOnly) {
  CFArrayRef list = CGWindowListCopyWindowInfo(
      kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID);
  if (!list) { fprintf(stderr, "no window list\n"); exit(1); }
  CFIndex n = CFArrayGetCount(list);
  for (CFIndex i = 0; i < n; i++) {
    CFDictionaryRef w = CFArrayGetValueAtIndex(list, i);
    int num = 0; double layer = 0;
    CFNumberRef numRef = CFDictionaryGetValue(w, kCGWindowNumber);
    CFNumberRef layerRef = CFDictionaryGetValue(w, kCGWindowLayer);
    if (numRef) CFNumberGetValue(numRef, kCFNumberIntType, &num);
    if (layerRef) CFNumberGetValue(layerRef, kCFNumberDoubleType, &layer);
    if (layer != 0) continue; // 只保留普通窗口
    if (onlyId && num != onlyId) continue;

    pid_t pid = 0;
    CFNumberRef pidRef = CFDictionaryGetValue(w, kCGWindowOwnerPID);
    if (pidRef) CFNumberGetValue(pidRef, kCFNumberSInt32Type, &pid);

    char owner[256] = "", title[512] = "";
    CFStringRef ownerRef = CFDictionaryGetValue(w, kCGWindowOwnerName);
    if (ownerRef) CFStringGetCString(ownerRef, owner, sizeof(owner), kCFStringEncodingUTF8);
    CFStringRef titleRef = CFDictionaryGetValue(w, kCGWindowName);
    if (titleRef) CFStringGetCString(titleRef, title, sizeof(title), kCFStringEncodingUTF8);

    CGRect rect = CGRectZero;
    CFDictionaryRef boundsRef = CFDictionaryGetValue(w, kCGWindowBounds);
    if (boundsRef) CGRectMakeWithDictionaryRepresentation(boundsRef, &rect);

    if (boundsOnly) {
      printf("%d %.1f %.1f %.1f %.1f\n", pid, rect.origin.x, rect.origin.y, rect.size.width, rect.size.height);
    } else {
      printf("%d\t%d\t%s\t%s\t%.0f %.0f %.0f %.0f\n", num, pid, owner, title,
             rect.origin.x, rect.origin.y, rect.size.width, rect.size.height);
    }
  }
  CFRelease(list);
}

// 真机验证: 微信小程序对 CGEventPostToPid 投递的事件时灵时不灵(重启会话后稳定拒收),
// 而 HID 级 CGEventPost 始终被接受 -> 统一走 HID 事件流(配合调用前 AXRaise 前置窗口)。
// pid 参数保留仅为兼容旧调用方, 实际忽略。
static CGEventSourceRef g_src = NULL;
static void postTo(pid_t pid, CGEventType type, CGPoint p) {
  (void)pid;
  if (!g_src) g_src = CGEventSourceCreate(kCGEventSourceStateHIDSystemState);
  CGEventRef ev = CGEventCreateMouseEvent(g_src, type, p, kCGMouseButtonLeft);
  CGEventPost(kCGHIDEventTap, ev);
  if (ev) CFRelease(ev);
}

int main(int argc, const char *argv[]) {
  if (argc < 2) { fprintf(stderr, "usage: wininput list|bounds|click|drag ...\n"); return 2; }

  if (strcmp(argv[1], "list") == 0) { printWindows(0, 0); return 0; }

  if (strcmp(argv[1], "bounds") == 0 && argc == 3) {
    printWindows(atoi(argv[2]), 1);
    return 0;
  }

  if (strcmp(argv[1], "click") == 0 && argc == 5) {
    pid_t pid = atoi(argv[2]);
    CGPoint p = CGPointMake(atof(argv[3]), atof(argv[4]));
    postTo(pid, kCGEventLeftMouseDown, p);
    usleep(60000);
    postTo(pid, kCGEventLeftMouseUp, p);
    printf("ok click %d %.1f,%.1f\n", pid, p.x, p.y);
    return 0;
  }

  if (strcmp(argv[1], "drag") == 0 && argc >= 7) {
    pid_t pid = atoi(argv[2]);
    CGPoint s = CGPointMake(atof(argv[3]), atof(argv[4]));
    CGPoint e = CGPointMake(atof(argv[5]), atof(argv[6]));
    int steps = argc > 7 ? atoi(argv[7]) : 24;
    int delayMs = argc > 8 ? atoi(argv[8]) : 40;
    if (steps < 1) steps = 1;

    // 悬停: 让游戏先"看到"光标落在目标砖上
    postTo(pid, kCGEventMouseMoved, s);
    usleep(120000);
    postTo(pid, kCGEventLeftMouseDown, s);
    usleep(220000);
    // 微抖动: 超过小程序 canvas 的拖拽启动阈值, 否则整段被当作点击忽略
    postTo(pid, kCGEventLeftMouseDragged, CGPointMake(s.x + 3, s.y + 3));
    usleep(60000);
    postTo(pid, kCGEventLeftMouseDragged, s);
    usleep(60000);
    for (int i = 1; i <= steps; i++) {
      double t = (double)i / steps;
      // 缓入缓出, 更接近真实手势
      double ease = t < 0.5 ? 2 * t * t : 1 - (1 - t) * (1 - t) / 2;
      CGPoint p = CGPointMake(s.x + (e.x - s.x) * ease, s.y + (e.y - s.y) * ease);
      postTo(pid, kCGEventLeftMouseDragged, p);
      usleep(delayMs * 1000);
    }
    // 终点悬停后松开
    usleep(220000);
    postTo(pid, kCGEventLeftMouseUp, e);
    printf("ok drag %d %.1f,%.1f -> %.1f,%.1f\n", pid, s.x, s.y, e.x, e.y);
    return 0;
  }

  fprintf(stderr, "bad args\n");
  return 2;
}
