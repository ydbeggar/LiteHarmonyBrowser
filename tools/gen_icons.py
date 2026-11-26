# -*- coding: utf-8 -*-
"""
轻鸿浏览器 v2.5 高清图标生成器（Pillow，一次性可复现工具）。

输出：entry/src/main/js/MainAbility/common/*.png（英文 ASCII 命名）
风格：白色线框（#FFFFFF，透明底），80x80 素材（@2x，显示 36~40px），
      4x 超采样绘制后 LANCZOS 缩图，边缘抗锯齿。

几何规范（用户验收标准）：
- 放大镜手柄为直线段，与镜圆相接于一点，且在接触点与圆的切线垂直
  => 手柄方向必须沿半径方向（过圆心）。ic_search 按此精确作图。
- 五角星：10 顶点（外径 R，内径 0.382R），镂空=描边、实心=填充。
"""
import math
import os

from PIL import Image, ImageDraw

S = 4                     # 超采样倍数
N = 80                    # 输出边长
BIG = N * S               # 画布边长
W = (255, 255, 255, 255)  # 白色

OUT_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    'entry', 'src', 'main', 'js', 'MainAbility', 'common'
)


def canvas():
    img = Image.new('RGBA', (BIG, BIG), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)


def sc(*vals):
    return [v * S for v in vals]


def circle(d, cx, cy, r, width):
    d.ellipse(sc(cx - r, cy - r, cx + r, cy + r), outline=W, width=int(width * S))


def dot(d, cx, cy, r):
    d.ellipse(sc(cx - r, cy - r, cx + r, cy + r), fill=W)


def line(d, x1, y1, x2, y2, width, cap=True):
    d.line(sc(x1, y1, x2, y2), fill=W, width=int(width * S))
    if cap:
        half = width / 2.0
        dot(d, x1, y1, half)
        dot(d, x2, y2, half)


def rrect(d, x1, y1, x2, y2, radius, width):
    d.rounded_rectangle(sc(x1, y1, x2, y2), radius=radius * S, outline=W, width=int(width * S))


def star_points(cx, cy, r_out, r_in, n=5, start_deg=-90.0):
    pts = []
    for i in range(n * 2):
        r = r_out if i % 2 == 0 else r_in
        a = math.radians(start_deg + i * (180.0 / n))
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def save(img, name):
    """图标输出：按 alpha 包围盒**自动居中**后缩图（v3.8）。

    几何居中 ≠ 视觉居中——ic_search 墨迹中心 (32.75,32.75)、ic_clock (36,36)
    偏离画布中心，真机被用户点名"与圆形背景不居中"。统一按墨迹包围盒居中
    根治全部图标（shader 类整幅贴图不经此函数）。
    """
    bbox = img.getbbox()
    if bbox:
        crop = img.crop(bbox)
        centered = Image.new('RGBA', (BIG, BIG), (0, 0, 0, 0))
        centered.paste(crop, ((BIG - crop.width) // 2, (BIG - crop.height) // 2))
        img = centered
    img = img.resize((N, N), Image.LANCZOS)
    path = os.path.join(OUT_DIR, name)
    img.save(path)
    print('wrote %s (%d bytes)' % (path, os.path.getsize(path)))


def ic_search():
    """放大镜：镜圆 + 沿半径方向（45°）的直手柄，接触点与切线垂直。"""
    img, d = canvas()
    cx, cy, r = 28.0, 28.0, 19.0
    circle(d, cx, cy, r, 5)
    # 手柄：方向 (cos45, sin45) 即过圆心的半径方向；起点略压镜环，端点圆帽
    k = math.sqrt(0.5)
    x1, y1 = cx + (r - 2) * k, cy + (r - 2) * k
    x2, y2 = cx + (r + 17) * k, cy + (r + 17) * k
    line(d, x1, y1, x2, y2, 6)
    save(img, 'ic_search.png')


def ic_book():
    """书本 + 书签带。"""
    img, d = canvas()
    rrect(d, 16, 12, 64, 68, 6, 5)
    # 书签带（自顶边垂下，尾部分叉）
    d.polygon([sc(46, 12)[0], sc(46, 12)[1], sc(60, 12)[0], sc(60, 12)[1],
               sc(60, 34)[0], sc(60, 34)[1], sc(53, 28)[0], sc(53, 28)[1],
               sc(46, 34)[0], sc(46, 34)[1]], fill=W)
    save(img, 'ic_book.png')


def ic_clock():
    """时钟：表环 + 时针 + 分针 + 轴心。"""
    img, d = canvas()
    circle(d, 36, 36, 26, 5)
    line(d, 36, 36, 24, 27, 5)     # 时针 ~10 点
    line(d, 36, 36, 36, 17, 5)     # 分针 12 点
    dot(d, 36, 36, 3)
    save(img, 'ic_clock.png')


def ic_doc():
    """文档：纸张 + 折角 + 两行文字线。"""
    img, d = canvas()
    rrect(d, 18, 10, 62, 70, 6, 5)
    line(d, 47, 11, 47, 24, 4, cap=False)
    line(d, 47, 24, 61, 24, 4, cap=False)
    line(d, 28, 38, 52, 38, 5)
    line(d, 28, 52, 52, 52, 5)
    save(img, 'ic_doc.png')


def ic_target():
    """靶心：外环 + 内环 + 中心点。"""
    img, d = canvas()
    circle(d, 40, 40, 27, 5)
    circle(d, 40, 40, 13, 5)
    dot(d, 40, 40, 4)
    save(img, 'ic_target.png')


def ic_link():
    """链条：两环斜向相扣。"""
    img, d = canvas()
    circle(d, 30, 50, 15, 5)
    circle(d, 50, 30, 15, 5)
    save(img, 'ic_link.png')


def ic_save():
    """保存离线：下箭头 + 托盘线。"""
    img, d = canvas()
    line(d, 40, 12, 40, 46, 6)
    d.line(sc(26, 34, 40, 48), fill=W, width=int(6 * S))
    d.line(sc(40, 48, 54, 34), fill=W, width=int(6 * S))
    dot(d, 26, 34, 3)
    dot(d, 54, 34, 3)
    dot(d, 40, 48, 3)
    line(d, 22, 64, 58, 64, 6)
    save(img, 'ic_save.png')


def ic_gear():
    """设置：齿轮（中心环 + 8 齿 + 中心孔）。"""
    img, d = canvas()
    circle(d, 40, 40, 17, 5)
    circle(d, 40, 40, 7, 4)
    for i in range(8):
        a = math.radians(i * 45.0)
        x1 = 40 + 16 * math.cos(a)
        y1 = 40 + 16 * math.sin(a)
        x2 = 40 + 27 * math.cos(a)
        y2 = 40 + 27 * math.sin(a)
        line(d, x1, y1, x2, y2, 8)
    save(img, 'ic_gear.png')


def ic_back():
    """返回：粗 chevron（‹）两段斜线 + 圆帽端点（v3.8，替代 28px 文字字形——
    字形在 52px 圆钮里既小又偏心；chevron 包围盒自动居中后视觉严格居中）。"""
    img, d = canvas()
    d.line(sc(52, 18, 30, 40), fill=W, width=int(7 * S))
    d.line(sc(30, 40, 52, 62), fill=W, width=int(7 * S))
    dot(d, 52, 18, 3.5)
    dot(d, 30, 40, 3.5)
    dot(d, 52, 62, 3.5)
    save(img, 'ic_back.png')


def star_line():
    """镂空五角星（收藏按钮未选中 / 收藏工具图标）。"""
    img, d = canvas()
    pts = star_points(40, 40, 30, 11.5)
    d.polygon([sc(x, y) for x, y in pts], outline=W, width=int(4 * S))
    save(img, 'star_line.png')


def star_full():
    """实心五角星（收藏按钮已选中）。"""
    img, d = canvas()
    pts = star_points(40, 40, 30, 11.5)
    d.polygon([sc(x, y) for x, y in pts], fill=W)
    save(img, 'star_full.png')


def shader():
    """底部「高斯模糊式」渐变贴图（复刻微信 v1.1 shader.png 像素曲线）。

    微信实测（FIT4 包 common/image/shader.png，466×48 显示为 408×48 @top:436）：
    纯黑 + alpha 线性上升 α(y)=min(255, 3+6.55y)，约 40px 处到全实。
    本图按目标 408×48 原生生成（无缩放），叠加在页面底部 436..480。
    """
    h = 48
    img = Image.new('RGBA', (N * 5, h), (0, 0, 0, 0))  # 408 宽近似（80*5=400 → 直接 408）
    img = Image.new('RGBA', (408, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for y in range(h):
        a = int(round(3 + 6.55 * y))
        if a > 255:
            a = 255
        d.line([(0, y), (407, y)], fill=(0, 0, 0, a))
    path = os.path.join(OUT_DIR, 'shader.png')
    img.save(path)
    print('wrote %s (%d bytes)' % (path, os.path.getsize(path)))


def ic_novel():
    """小说搜索：打开的书 + 右上角四角星点（区别于书签的闭合书本）。"""
    img, d = canvas()
    # 左右两页：外轮廓 + 书脊
    d.polygon([sc(14, 24), sc(38, 19), sc(38, 62), sc(14, 67)],
              outline=W, width=int(5 * S))
    d.polygon([sc(42, 19), sc(66, 24), sc(66, 67), sc(42, 62)],
              outline=W, width=int(5 * S))
    line(d, 40, 19, 40, 63, 5, cap=False)
    # 右侧书页上的星点，暗示“找小说/推荐”
    cx, cy, r1, r2 = 58.0, 26.0, 9.0, 3.0
    pts = []
    for i in range(8):
        r = r1 if i % 2 == 0 else r2
        a = math.radians(-90 + i * 45)
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    d.polygon([sc(x, y) for x, y in pts], fill=W)
    save(img, 'ic_novel.png')


def ic_ai():
    """增强搜索：四角星 + 小页面轮廓，表示 AI 阅读。"""
    img, d = canvas()
    rrect(d, 14, 12, 54, 68, 5, 4)
    line(d, 22, 26, 40, 26, 4)
    line(d, 22, 38, 36, 38, 4)
    # 右下角四角星
    cx, cy, r1, r2 = 58.0, 56.0, 16.0, 5.0
    pts = []
    for i in range(8):
        r = r1 if i % 2 == 0 else r2
        a = math.radians(-90 + i * 45)
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    d.polygon([sc(x, y) for x, y in pts], fill=W)
    save(img, 'ic_ai.png')


def ic_rss():
    """RSS：圆点 + 三道广播弧（经典 RSS 符号）。"""
    img, d = canvas()
    dot(d, 23, 57, 5)
    # 以左下角为圆心的三段 90° 弧
    for radius, width in ((16, 5), (28, 5), (40, 5)):
        box = sc(23 - radius, 57 - radius, 23 + radius, 57 + radius)
        d.arc(box, start=270, end=360, fill=W, width=int(width * S))
    save(img, 'ic_rss.png')


def shader_top():
    """顶部「高斯模糊式」渐变贴图（v2.9，底部 shader 的镜像朝向）。

    微信底部 shader.png 曲线：纯黑 α(y)=min(255, 3+6.55y)（实心端在屏幕底边，向上渐隐）。
    本图为镜像：实心端在**上**（紧贴「轻鸿浏览器」文字底缘 72px 处），向下渐隐，
    末 8px 近透明——标题文字底部不接触任何模糊，滚动内容向上渐隐入标题区。
    """
    h = 48
    img = Image.new('RGBA', (408, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for y in range(h):
        a = int(round(3 + 6.55 * (h - 1 - y)))
        if a > 255:
            a = 255
        d.line([(0, y), (407, y)], fill=(0, 0, 0, a))
    path = os.path.join(OUT_DIR, 'shader_top.png')
    img.save(path)
    print('wrote %s (%d bytes)' % (path, os.path.getsize(path)))


if __name__ == '__main__':
    os.makedirs(OUT_DIR, exist_ok=True)
    ic_search()
    ic_book()
    ic_novel()
    ic_ai()
    ic_rss()
    ic_clock()
    ic_doc()
    ic_target()
    ic_link()
    ic_save()
    ic_gear()
    ic_back()
    star_line()
    star_full()
    shader()
    shader_top()
    print('done: 16 assets -> %s' % OUT_DIR)
