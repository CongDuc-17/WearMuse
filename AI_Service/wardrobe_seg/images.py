"""Image decoding, normalization, cutouts and conservative quality checks."""
from __future__ import annotations
from io import BytesIO
from pathlib import Path
from PIL import Image, ImageOps, UnidentifiedImageError


class BadImage(ValueError):
    pass


def normalize_upload(data: bytes, *, max_pixels: int, max_side: int) -> tuple[bytes, int, int]:
    """Decode untrusted input, apply EXIF orientation and strip metadata.

    Re-encode to JPEG so downstream never uses attacker-provided filename or bytes.
    """
    try:
        with Image.open(BytesIO(data)) as src:
            if src.width * src.height > max_pixels:
                raise BadImage(f"Image too large: limit {max_pixels:,} pixels")
            if src.format not in {"JPEG", "PNG", "WEBP"}:
                raise BadImage("Only JPEG, PNG and WebP are supported")
            src.load()
            image = ImageOps.exif_transpose(src).convert("RGBA")
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        if isinstance(exc, BadImage):
            raise
        raise BadImage("Invalid or unsupported image") from exc

    # Transparent uploads are composited on white for consistent source pixels.
    white = Image.new("RGB", image.size, "white")
    white.paste(image, mask=image.getchannel("A"))
    if max(white.size) > max_side:
        white.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    output = BytesIO()
    white.save(output, format="JPEG", quality=92, optimize=True)
    return output.getvalue(), white.width, white.height


def quality_gate(img: Image.Image) -> dict:
    """Conservative heuristic flags; NOT a measure of true mask accuracy."""
    alpha = img.convert("RGBA").getchannel("A")
    hist = alpha.histogram()
    area = alpha.width * alpha.height
    # Fraction of pixels with alpha >= 128.
    fg = sum(hist[128:]) / area
    bbox = alpha.point(lambda x: 255 if x >= 128 else 0).getbbox()
    reasons: list[str] = []
    if fg < 0.025:
        reasons.append("foreground_too_small")
    if fg > 0.88:
        reasons.append("foreground_too_large")
    if bbox is None:
        reasons.append("empty_mask")
    else:
        left, top, right, bottom = bbox
        xmargin = max(2, alpha.width // 100)
        ymargin = max(2, alpha.height // 100)
        touches = sum((left <= xmargin, top <= ymargin,
                       right >= alpha.width - xmargin,
                       bottom >= alpha.height - ymargin))
        if touches >= 3:
            reasons.append("foreground_touches_multiple_edges")
    # Translucent alpha is legitimate (lace, sheer fabric), so do not reject it.
    return {
        "passed": len(reasons) == 0,
        "reasons": reasons,
        "foreground_fraction": round(fg, 5),
        "mask_bbox": list(bbox) if bbox else None,
    }


def save_png_atomic(img: Image.Image, path: Path) -> None:
    """Write a complete PNG before publishing the file path in the DB."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(".tmp")
    try:
        img.convert("RGBA").save(temp_path, format="PNG", optimize=True)
        temp_path.replace(path)
    finally:
        temp_path.unlink(missing_ok=True)


def decode_normalized(path: Path) -> Image.Image:
    with Image.open(path) as img:
        return img.convert("RGB")
