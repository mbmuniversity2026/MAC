"""Thumbnail generator — PIL/Pillow image composition.

Available to all users when model_thumbnail feature flag is enabled.
"""

import io
import base64
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from mac.database import get_db
from mac.middleware.auth_middleware import get_current_user
from mac.middleware.feature_gate import feature_required
from mac.models.user import User

router = APIRouter(prefix="/thumbnail", tags=["Thumbnail Generator"])

# Preset output sizes
SIZES = {
    "youtube":   (1280, 720),
    "ig_square": (1080, 1080),
    "ig_story":  (1080, 1920),
}

# Grid positions: "top-left", "top-center", ... "bottom-right"
POSITION_MAP = {
    "top-left":      (0.05, 0.10),
    "top-center":    (0.50, 0.10),
    "top-right":     (0.95, 0.10),
    "mid-left":      (0.05, 0.50),
    "mid-center":    (0.50, 0.50),
    "mid-right":     (0.95, 0.50),
    "bot-left":      (0.05, 0.90),
    "bot-center":    (0.50, 0.90),
    "bot-right":     (0.95, 0.90),
}

FONT_SIZES = {"small": 36, "medium": 56, "large": 80}


@router.post("/generate")
async def generate_thumbnail(
    background: UploadFile = File(...),
    title: str = Form(default=""),
    subtitle: str = Form(default=""),
    text_color: str = Form(default="#ffffff"),
    font_size: str = Form(default="medium"),   # small | medium | large | <number>
    position: str = Form(default="bot-center"),  # grid position key
    overlay_darkness: int = Form(default=50, ge=0, le=100),
    output_size: str = Form(default="youtube"),  # youtube | ig_square | ig_story | WxH
    output_format: str = Form(default="png"),    # png | jpg
    user: User = Depends(get_current_user),
    _fg: User = Depends(feature_required("model_thumbnail")),
    db: AsyncSession = Depends(get_db),
):
    """
    Compose a thumbnail:
    1. Resize background to output_size
    2. Apply overlay_darkness (0–100%) semi-transparent black layer
    3. Draw title + subtitle at the specified grid position
    4. Return PNG or JPEG bytes
    """
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        raise HTTPException(status_code=501, detail="Pillow not installed. Run: pip install Pillow")

    # Determine output dimensions
    if output_size in SIZES:
        width, height = SIZES[output_size]
    else:
        try:
            parts = output_size.lower().replace("x", "×").split("×")
            width, height = int(parts[0]), int(parts[1])
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid output_size. Use youtube|ig_square|ig_story|WxH")

    width = max(100, min(width, 4096))
    height = max(100, min(height, 4096))

    # Validate text color
    if not text_color.startswith("#") or len(text_color) not in (4, 7):
        text_color = "#ffffff"

    # Parse font size
    if font_size in FONT_SIZES:
        fs = FONT_SIZES[font_size]
    else:
        try:
            fs = max(10, min(int(font_size), 300))
        except ValueError:
            fs = 56

    # Parse position
    px_pct, py_pct = POSITION_MAP.get(position, (0.50, 0.90))
    is_centered = "center" in position
    anchor = "mm" if is_centered else ("lm" if "left" in position else "rm")

    # Read background image
    raw = await background.read()
    if len(raw) > 30 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Background image must be < 30 MB")

    try:
        img = Image.open(io.BytesIO(raw)).convert("RGBA")
    except Exception:
        raise HTTPException(status_code=400, detail="Cannot read image file")

    # Resize to output dimensions (fill, crop center)
    img_ratio = img.width / img.height
    target_ratio = width / height
    if img_ratio > target_ratio:
        new_h = height
        new_w = int(height * img_ratio)
    else:
        new_w = width
        new_h = int(width / img_ratio)
    img = img.resize((new_w, new_h), Image.LANCZOS)
    # Center crop
    left = (new_w - width) // 2
    top = (new_h - height) // 2
    img = img.crop((left, top, left + width, top + height))

    # Overlay darkness
    if overlay_darkness > 0:
        alpha = int(overlay_darkness / 100 * 255)
        overlay = Image.new("RGBA", img.size, (0, 0, 0, alpha))
        img = Image.alpha_composite(img, overlay)

    # Draw text
    draw = ImageDraw.Draw(img)

    def _hex_to_rgb(h: str):
        h = h.lstrip("#")
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

    color_rgb = _hex_to_rgb(text_color)

    # Try to load a font; fall back to default
    font_title = None
    font_sub = None
    for font_path in [
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/Windows/Fonts/arial.ttf",
        "/Windows/Fonts/calibrib.ttf",
    ]:
        try:
            font_title = ImageFont.truetype(font_path, fs)
            font_sub = ImageFont.truetype(font_path, max(12, fs // 2))
            break
        except Exception:
            pass

    # Text position (pixel coords)
    tx = int(px_pct * width)
    ty_title = int(py_pct * height)
    ty_sub = ty_title + fs + 10

    # Clamp subtitle within image
    if ty_sub + fs // 2 > height - 10:
        ty_sub = ty_title - fs // 2 - 12

    # Shadow for readability
    shadow_offset = max(2, fs // 20)
    shadow_color = (0, 0, 0, 180)

    if title:
        # Shadow
        draw.text((tx + shadow_offset, ty_title + shadow_offset),
                  title, font=font_title, fill=shadow_color, anchor=anchor)
        draw.text((tx, ty_title), title, font=font_title, fill=color_rgb + (255,), anchor=anchor)

    if subtitle:
        draw.text((tx + shadow_offset, ty_sub + shadow_offset),
                  subtitle, font=font_sub, fill=shadow_color, anchor=anchor)
        draw.text((tx, ty_sub), subtitle, font=font_sub, fill=color_rgb + (180,), anchor=anchor)

    # Convert to RGB for JPEG
    if output_format.lower() == "jpg":
        img = img.convert("RGB")
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=92)
        media_type = "image/jpeg"
        filename = "thumbnail.jpg"
    else:
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        media_type = "image/png"
        filename = "thumbnail.png"

    buf.seek(0)
    return Response(
        content=buf.read(),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
