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
#include <Carbon/Carbon.h>
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

// 直投目标进程事件队列(不经 HID, 不移动光标)。真机曾测被微信拒收, 保留子命令用于复测。
static void postPid(pid_t pid, CGEventType type, CGPoint p) {
  CGEventRef ev = CGEventCreateMouseEvent(NULL, type, p, kCGMouseButtonLeft);
  CGEventPostToPid(pid, ev);
  if (ev) CFRelease(ev);
}

// silent 模式: 手势期间断开"物理鼠标->光标"关联(用户移动鼠标不再驱动光标),
// 手势结束后把光标瞬移回手势开始前的位置, 再恢复关联。
// 用户视角: 光标几乎不离开原位, 游戏照常收到点击/拖拽。
static int g_silent = 0;
static CGPoint g_savedLoc;
static void silentBegin(void) {
  if (!g_silent) return;
  CGEventRef loc = CGEventCreate(NULL);
  g_savedLoc = CGEventGetLocation(loc);
  CFRelease(loc);
  CGAssociateMouseAndMouseCursorPosition(0);
}
static CGPoint silentEnd(void) {
  if (!g_silent) return CGEventGetLocation(CGEventCreate(NULL));
  CGWarpMouseCursorPosition(g_savedLoc);
  CGAssociateMouseAndMouseCursorPosition(1);
  CGEventRef loc = CGEventCreate(NULL);
  CGPoint p = CGEventGetLocation(loc);
  CFRelease(loc);
  return p;
}

// 全局停止热键: 事件钩子命中 ⌥⌘A (keycode 0 + Command+Alternate, 不含 Control) 即退出
static CGEventRef stopHotkeyCb(CGEventTapProxy proxy, CGEventType type, CGEventRef event, void *user) {
  (void)proxy; (void)type; (void)user;
  int64_t code = CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode);
  CGEventFlags f = CGEventGetFlags(event);
  if (code == 0x00 && (f & kCGEventFlagMaskCommand) && (f & kCGEventFlagMaskAlternate) &&
      !(f & kCGEventFlagMaskControl)) {
    printf("pressed\n");
    fflush(stdout);
    exit(0);
  }
  return NULL;
}

static CGEventRef keytapCb(CGEventTapProxy proxy, CGEventType type, CGEventRef event, void *user) {
  (void)proxy; (void)type; (void)user;
  int64_t code = CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode);
  printf("keyDown code=%lld flags=0x%llx\n", (long long)code, (unsigned long long)CGEventGetFlags(event));
  fflush(stdout);
  return NULL;
}

// keytest <keycode> <cmd> <opt> <ctrl> <shift>: 投递一次键盘组合键(仅用于自测热键)
static void postKey(CGKeyCode code, int cmd, int opt, int ctrl, int shift) {
  // 注意: 不能用 HIDSystemState 源, 否则 flags 会被真实键盘修饰键状态覆盖, 热键不触发
  CGEventFlags f = 0;
  if (cmd) f |= kCGEventFlagMaskCommand;
  if (opt) f |= kCGEventFlagMaskAlternate;
  if (ctrl) f |= kCGEventFlagMaskControl;
  if (shift) f |= kCGEventFlagMaskShift;
  CGEventRef d = CGEventCreateKeyboardEvent(NULL, code, true);
  CGEventSetFlags(d, f);
  CGEventPost(kCGHIDEventTap, d);
  usleep(40000);
  CGEventRef u = CGEventCreateKeyboardEvent(NULL, code, false);
  CGEventSetFlags(u, f);
  CGEventPost(kCGHIDEventTap, u);
  if (d) CFRelease(d);
  if (u) CFRelease(u);
}

int main(int argc, const char *argv[]) {
  if (argc < 2) { fprintf(stderr, "usage: wininput list|bounds|click|drag|clickpid|dragpid ...\n"); return 2; }

  if (strcmp(argv[1], "clickpid") == 0 && argc == 5) {
    pid_t pid = atoi(argv[2]);
    CGPoint p = CGPointMake(atof(argv[3]), atof(argv[4]));
    postPid(pid, kCGEventLeftMouseDown, p);
    usleep(60000);
    postPid(pid, kCGEventLeftMouseUp, p);
    printf("ok clickpid %d %.1f,%.1f\n", pid, p.x, p.y);
    return 0;
  }

  if (strcmp(argv[1], "dragpid") == 0 && argc >= 7) {
    pid_t pid = atoi(argv[2]);
    CGPoint s = CGPointMake(atof(argv[3]), atof(argv[4]));
    CGPoint e = CGPointMake(atof(argv[5]), atof(argv[6]));
    int steps = argc > 7 ? atoi(argv[7]) : 15;
    int delayMs = argc > 8 ? atoi(argv[8]) : 30;
    postPid(pid, kCGEventLeftMouseDown, s);
    usleep(80000);
    for (int i = 1; i <= steps; i++) {
      double t = (double)i / steps;
      CGPoint p = CGPointMake(s.x + (e.x - s.x) * t, s.y + (e.y - s.y) * t);
      postPid(pid, kCGEventLeftMouseDragged, p);
      usleep(delayMs * 1000);
    }
    postPid(pid, kCGEventLeftMouseUp, e);
    printf("ok dragpid %d %.1f,%.1f -> %.1f,%.1f\n", pid, s.x, s.y, e.x, e.y);
    return 0;
  }

  // axhit <pid> <x> <y>  探针: 打印该屏幕点命中的无障碍元素角色/尺寸/可执行动作
  // 目的: 判断微信小游戏画布是否把每块砖暴露为可独立点击的 AX 元素(唯一可能不移动光标的通道)
  if (strcmp(argv[1], "axhit") == 0 && argc == 5) {
    pid_t pid = atoi(argv[2]);
    CGPoint p = CGPointMake(atof(argv[3]), atof(argv[4]));
    AXUIElementRef app = AXUIElementCreateApplication(pid);
    AXUIElementRef el = NULL;
    AXError err = AXUIElementCopyElementAtPosition(app, (float)p.x, (float)p.y, &el);
    printf("trusted=%d copyErr=%d\n", (int)AXIsProcessTrusted(), (int)err);
    char roleBuf[128] = "?", subBuf[128] = "?";
    if (el) {
      CFStringRef role = NULL, subrole = NULL;
      AXUIElementCopyAttributeValue(el, kAXRoleAttribute, (CFTypeRef *)&role);
      AXUIElementCopyAttributeValue(el, kAXSubroleAttribute, (CFTypeRef *)&subrole);
      CFArrayRef actions = NULL;
      AXUIElementCopyActionNames(el, &actions);
      if (role) CFStringGetCString(role, roleBuf, sizeof(roleBuf), kCFStringEncodingUTF8);
      if (subrole) CFStringGetCString(subrole, subBuf, sizeof(subBuf), kCFStringEncodingUTF8);
      printf("role=%s subrole=%s\n", roleBuf, subBuf);
      if (actions) {
        printf("actions=%lu\n", (unsigned long)CFArrayGetCount(actions));
        for (CFIndex i = 0; i < CFArrayGetCount(actions); i++) {
          CFStringRef a = CFArrayGetValueAtIndex(actions, i);
          char ab[128] = "?";
          CFStringGetCString(a, ab, sizeof(ab), kCFStringEncodingUTF8);
          printf("  - %s\n", ab);
        }
      }
      CFRelease(actions);
      if (role) CFRelease(role);
      if (subrole) CFRelease(subrole);
      CFRelease(el);
    }
    CFRelease(app);
    return 0;
  }

  // hotkey: 常驻监听 ⌥A (keycode 0x00 = A), 命中打印 pressed 并退出。
  // 用 CGEventTap 而非 Carbon RegisterEventHotKey: 后者在 CLI 子进程中不派发事件。
  if (strcmp(argv[1], "hotkey") == 0) {
    CGEventMask mask = CGEventMaskBit(kCGEventKeyDown);
    CFMachPortRef tap = CGEventTapCreate(kCGHIDEventTap, kCGHeadInsertEventTap,
                                         kCGEventTapOptionListenOnly, mask, stopHotkeyCb, NULL);
    if (!tap) { fprintf(stderr, "hotkey tap create failed (需要辅助功能权限)\n"); return 1; }
    CFRunLoopAddSource(CFRunLoopGetCurrent(),
                       CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0), kCFRunLoopCommonModes);
    CGEventTapEnable(tap, true);
    printf("armed\n");
    fflush(stdout);
    CFRunLoopRun();
    return 0;
  }

  // keytap <seconds>: 监听会话键盘事件用于诊断(打印收到的 keycode/flags)
  if (strcmp(argv[1], "keytap") == 0 && argc == 3) {
    CGEventMask mask = CGEventMaskBit(kCGEventKeyDown);
    CFMachPortRef tap = CGEventTapCreate(kCGHIDEventTap, kCGHeadInsertEventTap,
                                         kCGEventTapOptionListenOnly, mask, keytapCb, NULL);
    if (!tap) { fprintf(stderr, "tap create failed\n"); return 1; }
    CFRunLoopAddSource(CFRunLoopGetCurrent(),
                       CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0), kCFRunLoopCommonModes);
    CGEventTapEnable(tap, true);
    printf("tapping %s s\n", argv[2]);
    fflush(stdout);
    CFRunLoopRunInMode(kCFRunLoopDefaultMode, atof(argv[2]), false);
    return 0;
  }

  // keytest: 投递 ⌥A 用于自测 hotkey 监听
  if (strcmp(argv[1], "keytest") == 0) {
    postKey((CGKeyCode)kVK_ANSI_A, 1, 1, 0, 0);
    printf("key posted\n");
    return 0;
  }

  if (strcmp(argv[1], "list") == 0) { printWindows(0, 0); return 0; }

  if (strcmp(argv[1], "where") == 0) {
    CGEventRef loc = CGEventCreate(NULL);
    CGPoint p = CGEventGetLocation(loc);
    CFRelease(loc);
    printf("%.1f %.1f\n", p.x, p.y);
    return 0;
  }

  if (strcmp(argv[1], "warp") == 0 && argc == 4) {
    CGWarpMouseCursorPosition(CGPointMake(atof(argv[2]), atof(argv[3])));
    printf("warped\n");
    return 0;
  }

  if (strcmp(argv[1], "bounds") == 0 && argc == 3) {
    printWindows(atoi(argv[2]), 1);
    return 0;
  }

  if (strcmp(argv[1], "click") == 0 && (argc == 5 || argc == 6)) {
    if (argc == 6 && strcmp(argv[5], "silent") == 0) g_silent = 1;
    pid_t pid = atoi(argv[2]);
    CGPoint p = CGPointMake(atof(argv[3]), atof(argv[4]));
    silentBegin();
    postTo(pid, kCGEventLeftMouseDown, p);
    usleep(60000);
    postTo(pid, kCGEventLeftMouseUp, p);
    CGPoint after = silentEnd();
    printf("ok click %d %.1f,%.1f cursor_after=%.1f,%.1f\n", pid, p.x, p.y, after.x, after.y);
    return 0;
  }

  if (strcmp(argv[1], "drag") == 0 && argc >= 7) {
    int silentArg = strcmp(argv[argc - 1], "silent") == 0;
    int numArgc = silentArg ? argc - 1 : argc;
    if (silentArg) g_silent = 1;
    pid_t pid = atoi(argv[2]);
    CGPoint s = CGPointMake(atof(argv[3]), atof(argv[4]));
    CGPoint e = CGPointMake(atof(argv[5]), atof(argv[6]));
    int steps = numArgc > 7 ? atoi(argv[7]) : 24;
    int delayMs = numArgc > 8 ? atoi(argv[8]) : 40;
    if (steps < 1) steps = 1;
    silentBegin();

    // 悬停: 让游戏先"看到"光标落在目标砖上
    postTo(pid, kCGEventMouseMoved, s);
    usleep(80000);
    postTo(pid, kCGEventLeftMouseDown, s);
    usleep(160000);
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
    usleep(160000);
    postTo(pid, kCGEventLeftMouseUp, e);
    CGPoint after = silentEnd();
    printf("ok drag %d %.1f,%.1f -> %.1f,%.1f cursor_after=%.1f,%.1f\n", pid, s.x, s.y, e.x, e.y, after.x, after.y);
    return 0;
  }

  fprintf(stderr, "bad args\n");
  return 2;
}
