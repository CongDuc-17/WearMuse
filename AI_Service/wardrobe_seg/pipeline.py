
"""
WearMuseMeow - AI Processing Pipeline

Flow:
    Original Image
        -> BiRefNet
        -> Quality Gate
        -> Image Normalization
        -> Thumbnail
        -> Ready
"""

from __future__ import annotations

import time
from pathlib import Path

from .config import Settings

from .db import (
    claim_one,
    finish,
    fail_or_requeue,
)

from .images import (
    decode_normalized,
    quality_gate,
    save_png_atomic,
)

from .normalizer import (
    normalize_cutout,
    make_thumbnail,
    save_webp_atomic,
)


def run_one(
    db_path: Path,
    settings: Settings,
    segmenter,
) -> dict | None:

    # --------------------------------------------------------
    # 1. Claim one queued job
    # --------------------------------------------------------

    item = claim_one(db_path)

    if item is None:
        return None

    start = time.perf_counter()

    try:

        # ----------------------------------------------------
        # 2. Load original image
        # ----------------------------------------------------

        source_path = (
            settings.data_dir
            / item["original_path"]
        )

        source = decode_normalized(source_path)

        # ----------------------------------------------------
        # 3. Remove background
        # ----------------------------------------------------

        raw_cutout = segmenter.cutout(source)

        if raw_cutout.size != source.size:
            raise RuntimeError(
                "Model returned unexpected image dimensions"
            )

        # ----------------------------------------------------
        # 4. Quality Gate
        # ----------------------------------------------------

        quality = quality_gate(raw_cutout)

        version = (
            f"{item['id']}-v{item['attempts']}"
        )

        # ----------------------------------------------------
        # 5. Process valid masks
        # ----------------------------------------------------

        if quality["passed"]:

            # Keep original model output for debugging.
            raw_path = (
                f"raw_cutouts/{version}.png"
            )

            # This will be the normalized showroom image.
            cutout_path = (
                f"cutouts/{version}.png"
            )

            # Small mobile preview.
            thumbnail_path = (
                f"thumbnails/{version}.webp"
            )

            # Save unmodified BiRefNet result.
            save_png_atomic(
                raw_cutout,
                settings.data_dir / raw_path,
            )

            # -----------------------------------------------
            # 6. Normalize image
            # -----------------------------------------------

            normalized = normalize_cutout(
                raw_cutout
            )

            save_png_atomic(
                normalized,
                settings.data_dir / cutout_path,
            )

            # -----------------------------------------------
            # 7. Generate thumbnail
            # -----------------------------------------------

            thumbnail = make_thumbnail(
                normalized
            )

            save_webp_atomic(
                thumbnail,
                settings.data_dir / thumbnail_path,
            )

            status = "ready"

            review_path = None

        # ----------------------------------------------------
        # 8. Process suspicious masks
        # ----------------------------------------------------

        else:

            status = "needs_review"

            review_path = (
                f"review/{version}.png"
            )

            save_png_atomic(
                raw_cutout,
                settings.data_dir / review_path,
            )

            cutout_path = None

        # ----------------------------------------------------
        # 9. Update database
        # ----------------------------------------------------

        elapsed = round(
            time.perf_counter() - start,
            4,
        )

        finish(
            db_path,
            item["id"],
            status=status,
            model=segmenter.name,
            elapsed=elapsed,
            cutout_path=cutout_path,
            review_path=review_path,
            quality=quality,
        )

        return {
            "id": item["id"],
            "status": status,
            "quality": quality,
        }

    # --------------------------------------------------------
    # 10. Error handling
    # --------------------------------------------------------

    except Exception as exc:

        fail_or_requeue(
            db_path,
            item,
            f"{type(exc).__name__}: {exc}",
            settings.max_attempts,
        )

        return {
            "id": item["id"],
            "status": "error",
            "error": str(exc),
        }
