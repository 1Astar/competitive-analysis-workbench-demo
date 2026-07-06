# -*- coding: utf-8 -*-
"""为 GitHub 公开版截图添加水印（需 Pillow）。"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "screenshots"

SOURCES = [
    (
        Path(r"C:\Users\l1397\.cursor\projects\e-star\assets"
             r"\c__Users_l1397_AppData_Roaming_Cursor_User_workspaceStorage_82f4bd83269ce590ebe0f2c685e18d8d_images_image-1cd928d8-ceb2-4108-853c-c3e795a4963f.png"),
        "04-data-import.png",
    ),
    (
        Path(r"C:\Users\l1397\.cursor\projects\e-star\assets"
             r"\c__Users_l1397_AppData_Roaming_Cursor_User_workspaceStorage_82f4bd83269ce590ebe0f2c685e18d8d_images_image-69a92f44-53f0-4ce5-897b-f4a37a2feb80.png"),
        "05-project-risk.png",
    ),
    (
        Path(r"C:\Users\l1397\.cursor\projects\e-star\assets"
             r"\c__Users_l1397_AppData_Roaming_Cursor_User_workspaceStorage_82f4bd83269ce590ebe0f2c685e18d8d_images_image-8e81090c-9352-4353-bdb2-231107634bb3.png"),
        "06-returns-analysis.png",
    ),
]

WATERMARK_LINE = "DEMO · 公开演示 · 刘星雨"
FOOTER = "Copyright © 2026 刘星雨 · 未经许可不得复制、修改、商用或二次分发"


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in (
        r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\msyhbd.ttc",
        r"C:\Windows\Fonts\simhei.ttf",
    ):
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def text_size(draw: ImageDraw.ImageDraw, text: str, font) -> tuple[int, int]:
    try:
        bbox = draw.textbbox((0, 0), text, font=font)
        return bbox[2] - bbox[0], bbox[3] - bbox[1]
    except AttributeError:
        return draw.textsize(text, font=font)


def add_watermark(src: Path, dest: Path) -> None:
    base = Image.open(src).convert("RGBA")
    w, h = base.size
    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))

    font_diag = load_font(max(22, w // 48))
    font_footer = load_font(max(15, w // 80))

    # 斜向平铺水印层
    big = Image.new("RGBA", (int(w * 1.8), int(h * 1.8)), (0, 0, 0, 0))
    bd = ImageDraw.Draw(big)
    step_y = max(72, h // 9)
    step_x = max(260, w // 5)
    y = 0
    row = 0
    while y < big.height:
        x = (row % 2) * (step_x // 2)
        while x < big.width:
            bd.text((x, y), WATERMARK_LINE, fill=(100, 105, 120, 48), font=font_diag)
            x += step_x
        y += step_y
        row += 1
    big = big.rotate(22, expand=True)
    cx = (big.width - w) // 2
    cy = (big.height - h) // 2
    overlay = Image.alpha_composite(overlay, big.crop((cx, cy, cx + w, cy + h)))

    # 底部版权条
    footer_draw = ImageDraw.Draw(overlay)
    tw, th = text_size(footer_draw, FOOTER, font_footer)
    bar_h = th + 22
    bar = Image.new("RGBA", (w, bar_h), (12, 14, 22, 210))
    bdraw = ImageDraw.Draw(bar)
    bdraw.text(((w - tw) // 2, 8), FOOTER, fill=(240, 240, 245, 240), font=font_footer)
    overlay.paste(bar, (0, h - bar_h), bar)

    result = Image.alpha_composite(base, overlay).convert("RGB")
    dest.parent.mkdir(parents=True, exist_ok=True)
    result.save(dest, "PNG", optimize=True)
    print(f"OK {dest.name} ({w}x{h})")


def main() -> int:
    ok = 0
    for src, name in SOURCES:
        if not src.exists():
            print(f"SKIP missing: {src}", file=sys.stderr)
            continue
        add_watermark(src, OUT / name)
        ok += 1
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
