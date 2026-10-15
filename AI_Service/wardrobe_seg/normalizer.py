
"""
WearMuseMeow - Image Normalization

Convert a transparent garment cutout into a standardized
showroom image and an optimized thumbnail.

Input:
    RGBA image from BiRefNet

Output:
    768x1024 transparent showroom PNG
    384x512 transparent WebP thumbnail
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image


# ============================================================
# SETTINGS
# ============================================================

CANVAS_SIZE = (768, 1024)

THUMBNAIL_SIZE = (384, 512)

# Safe empty area surrounding the garment.
PADDING_RATIO = 0.10

# Ignore nearly transparent pixels when finding object bounds.
ALPHA_THRESHOLD = 16


# ============================================================
# ALPHA-AWARE RESIZE
# ============================================================

def _resize_rgba(
    image: Image.Image,
    size: tuple[int, int],
) -> Image.Image:
    """
    Resize using premultiplied alpha.

    Helps reduce color halos around transparent garment edges.
    """

    return (
        image.convert("RGBA")
        .convert("RGBa")
        .resize(size, Image.Resampling.LANCZOS)
        .convert("RGBA")
    )


# ============================================================
# IMAGE NORMALIZATION
# ============================================================

def normalize_cutout(
    cutout: Image.Image,
    *,
    canvas_size: tuple[int, int] = CANVAS_SIZE,
    padding_ratio: float = PADDING_RATIO,
) -> Image.Image:
    """
    Normalize garment image:

    1. Find foreground bounding box.
    2. Crop transparent space.
    3. Preserve aspect ratio.
    4. Resize garment to fit safe area.
    5. Center on transparent canvas.

    Does not modify source image.
    """

    if not 0 <= padding_ratio < 0.5:
        raise ValueError(
            "padding_ratio must be in [0, 0.5)"
        )

    canvas_width, canvas_height = canvas_size

    if canvas_width <= 0 or canvas_height <= 0:
        raise ValueError(
            "Canvas dimensions must be positive"
        )

    image = cutout.convert("RGBA")

    # --------------------------------------------------------
    # 1. Find foreground bounding box
    # --------------------------------------------------------

    alpha = image.getchannel("A")

    mask = alpha.point(
        lambda value: (
            255 if value >= ALPHA_THRESHOLD else 0
        )
    )

    bbox = mask.getbbox()

    if bbox is None:
        raise ValueError(
            "Cannot normalize empty alpha mask"
        )

    left, top, right, bottom = bbox

    # --------------------------------------------------------
    # 2. Add a small safety margin before cropping
    # --------------------------------------------------------

    bbox_width = right - left
    bbox_height = bottom - top

    margin = max(
        2,
        round(max(bbox_width, bbox_height) * 0.02),
    )

    left = max(0, left - margin)
    top = max(0, top - margin)

    right = min(image.width, right + margin)
    bottom = min(image.height, bottom + margin)

    cropped = image.crop(
        (left, top, right, bottom)
    )

    # --------------------------------------------------------
    # 3. Calculate available canvas space
    # --------------------------------------------------------

    available_width = round(
        canvas_width * (1 - 2 * padding_ratio)
    )

    available_height = round(
        canvas_height * (1 - 2 * padding_ratio)
    )

    # --------------------------------------------------------
    # 4. Preserve aspect ratio
    # --------------------------------------------------------

    scale = min(
        available_width / cropped.width,
        available_height / cropped.height,
    )

    target_width = max(
        1,
        round(cropped.width * scale),
    )

    target_height = max(
        1,
        round(cropped.height * scale),
    )

    resized = _resize_rgba(
        cropped,
        (target_width, target_height),
    )

    # --------------------------------------------------------
    # 5. Create transparent canvas
    # --------------------------------------------------------

    canvas = Image.new(
        "RGBA",
        canvas_size,
        (0, 0, 0, 0),
    )

    # --------------------------------------------------------
    # 6. Center garment
    # --------------------------------------------------------

    x = (canvas_width - target_width) // 2
    y = (canvas_height - target_height) // 2

    canvas.alpha_composite(
        resized,
        (x, y),
    )

    return canvas


# ============================================================
# THUMBNAIL GENERATION
# ============================================================

def make_thumbnail(
    normalized: Image.Image,
    *,
    size: tuple[int, int] = THUMBNAIL_SIZE,
) -> Image.Image:
    """
    Generate a smaller transparent image for mobile lists.
    """

    return _resize_rgba(
        normalized,
        size,
    )


# ============================================================
# ATOMIC WEBP SAVING
# ============================================================

def save_webp_atomic(
    image: Image.Image,
    path: Path,
) -> None:
    """
    Save WebP safely.

    File is written completely before being published.
    """

    path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    temp_path = path.with_suffix(".tmp")

    try:
        image.convert("RGBA").save(
            temp_path,
            format="WEBP",
            quality=85,
            method=4,
        )

        temp_path.replace(path)

    finally:
        temp_path.unlink(missing_ok=True)
