// mouse_drag.c — 系统鼠标拖拽助手（零外部依赖, 仅使用 CoreGraphics）
//
// 用法: mouse_drag <startXPx> <startYPx> <endXPx> <endYPx> <imgW> <imgH>
// 坐标为"截图图像像素"坐标（screencapture 全屏截图的像素空间）。
// 内部按主显示器 CGDisplayBounds 将像素比例换算为全局显示点坐标（自动处理 Retina 缩放），
// 然后投递 左键 down -> 分步 move(约300ms) -> up 事件序列。
#include <ApplicationServices/ApplicationServices.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

int main(int argc, const char *argv[]) {
    if (argc != 7) {
        fprintf(stderr, "usage: mouse_drag sx sy ex ey imgW imgH\n");
        return 2;
    }
    double sx = atof(argv[1]);
    double sy = atof(argv[2]);
    double ex = atof(argv[3]);
    double ey = atof(argv[4]);
    double imgW = atof(argv[5]);
    double imgH = atof(argv[6]);
    if (imgW <= 0 || imgH <= 0) {
        fprintf(stderr, "invalid image size\n");
        return 2;
    }

    CGDirectDisplayID disp = CGMainDisplayID();
    CGRect b = CGDisplayBounds(disp);

    // 截图覆盖整个主显示器: 像素比例 -> 显示点比例
    CGPoint start = CGPointMake(b.origin.x + sx / imgW * b.size.width,
                                b.origin.y + sy / imgH * b.size.height);
    CGPoint end = CGPointMake(b.origin.x + ex / imgW * b.size.width,
                              b.origin.y + ey / imgH * b.size.height);

    CGEventSourceRef src = CGEventSourceCreate(kCGEventSourceStateHIDSystemState);
    CGEventRef down = CGEventCreateMouseEvent(src, kCGEventLeftMouseDown, start, kCGMouseButtonLeft);
    CGEventPost(kCGHIDEventTap, down);
    usleep(80000);

    const int steps = 15;
    for (int i = 1; i <= steps; i++) {
        double t = (double)i / steps;
        CGPoint p = CGPointMake(start.x + (end.x - start.x) * t,
                                start.y + (end.y - start.y) * t);
        CGEventRef drag = CGEventCreateMouseEvent(src, kCGEventLeftMouseDragged, p, kCGMouseButtonLeft);
        CGEventPost(kCGHIDEventTap, drag);
        CFRelease(drag);
        usleep(20000); // 合计约 300ms
    }

    CGEventRef up = CGEventCreateMouseEvent(src, kCGEventLeftMouseUp, end, kCGMouseButtonLeft);
    CGEventPost(kCGHIDEventTap, up);

    CFRelease(down);
    CFRelease(up);
    if (src) CFRelease(src);

    printf("ok %.1f,%.1f -> %.1f,%.1f\n", start.x, start.y, end.x, end.y);
    return 0;
}
