
"""
WearMuseMeow - Local AI Service API

Development only.
No authentication. Bind to localhost.
"""

from __future__ import annotations

import json
import hashlib
import uuid

from pathlib import Path

from fastapi import (
    FastAPI,
    File,
    UploadFile,
    HTTPException,
    Header,
)

from fastapi.responses import FileResponse

from pydantic import BaseModel

from .config import Settings

from .db import (
    init_db,
    create_item,
    get_item,
    requeue,
    IdempotencyConflict,
)

from .images import (
    BadImage,
    normalize_upload,
)


# ============================================================
# RESPONSE MODEL
# ============================================================

class ItemResponse(BaseModel):

    id: str
    status: str

    original_url: str
    preview_url: str

    cutout_url: str | None
    thumbnail_url: str | None = None
    review_url: str | None

    quality: dict | None
    model: str | None

    inference_seconds: float | None

    attempts: int
    error: str | None


# ============================================================
# ASSET PATHS
# ============================================================

def thumbnail_path(item: dict) -> str | None:

    if item["status"] != "ready":
        return None

    cutout_path = item["cutout_path"]

    if not cutout_path:
        return None

    filename = (
        Path(cutout_path).stem + ".webp"
    )

    return f"thumbnails/{filename}"


# ============================================================
# API RESPONSE
# ============================================================

def item_view(
    item: dict,
    data_dir: Path,
) -> dict:

    item_id = item["id"]

    base_url = f"/v1/items/{item_id}/assets"

    original_url = (
        f"{base_url}/original"
    )

    cutout_url = (
        f"{base_url}/cutout"
        if item["cutout_path"]
        else None
    )

    review_url = (
        f"{base_url}/review"
        if item["review_path"]
        else None
    )

    thumb_path = thumbnail_path(item)

    thumbnail_url = None

    if thumb_path:
        full_thumb_path = data_dir / thumb_path

        if full_thumb_path.is_file():
            thumbnail_url = (
                f"{base_url}/thumbnail"
            )

    # Keep original preview until processing succeeds.
    if item["status"] == "ready" and cutout_url:
        preview_url = cutout_url
    else:
        preview_url = original_url

    return {
        "id": item_id,

        "status": item["status"],

        "original_url": original_url,

        "preview_url": preview_url,

        "cutout_url": cutout_url,

        "thumbnail_url": thumbnail_url,

        "review_url": review_url,

        "quality": (
            json.loads(item["quality_json"])
            if item["quality_json"]
            else None
        ),

        "model": item["model"],

        "inference_seconds": (
            item["inference_seconds"]
        ),

        "attempts": item["attempts"],

        "error": item["error"],
    }


# ============================================================
# FASTAPI APPLICATION
# ============================================================

def create_app(
    settings: Settings | None = None,
) -> FastAPI:

    settings = settings or Settings.from_env()

    settings.ensure()

    db_path = (
        settings.data_dir / "jobs.sqlite3"
    )

    init_db(db_path)

    app = FastAPI(
        title="WearMuseMeow AI Service",
        version="0.2.0",
    )

    # --------------------------------------------------------
    # HEALTH
    # --------------------------------------------------------

    @app.get("/health")
    def health():

        return {
            "ok": True,
            "ai_engine": "separate worker",
            "data_dir": str(settings.data_dir),
        }

    # --------------------------------------------------------
    # UPLOAD ITEM
    # --------------------------------------------------------

    @app.post(
        "/v1/items",
        status_code=202,
        response_model=ItemResponse,
    )
    async def upload_one(
        file: UploadFile = File(...),
        idempotency_key: str | None = Header(
            default=None, alias="Idempotency-Key", min_length=1, max_length=100,
            pattern=r"^[A-Za-z0-9_-]+$",
        ),
    ):

        max_bytes = (
            settings.max_upload_mb
            * 1024
            * 1024
        )

        data = await file.read(
            max_bytes + 1
        )

        await file.close()

        if not data:
            raise HTTPException(
                400,
                "Empty image",
            )

        if len(data) > max_bytes:
            raise HTTPException(
                413,
                f"Image exceeds {settings.max_upload_mb} MB",
            )

        try:

            image_bytes, width, height = (
                normalize_upload(
                    data,
                    max_pixels=settings.max_image_pixels,
                    max_side=settings.max_side,
                )
            )

        except BadImage as exc:
            raise HTTPException(
                415,
                str(exc),
            ) from exc

        filename = (
            f"{uuid.uuid4().hex}.jpg"
        )

        rel_path = (
            f"originals/{filename}"
        )

        image_path = (
            settings.data_dir / rel_path
        )

        item = None
        try:
            image_path.write_bytes(image_bytes)

            item = create_item(
                db_path,

                original_filename=(
                    Path(
                        file.filename or "upload"
                    ).name[:150]
                ),

                original_path=rel_path,

                width=width,
                height=height,
                idempotency_key=idempotency_key,
                request_sha256=hashlib.sha256(data).hexdigest() if idempotency_key is not None else None,
            )

        except IdempotencyConflict as exc:
            raise HTTPException(409, "Upload key already belongs to another image") from exc
        finally:
            if item is None or item['original_path'] != rel_path:
                image_path.unlink(missing_ok=True)

        return item_view(
            item,
            settings.data_dir,
        )

    # --------------------------------------------------------
    # GET ITEM
    # --------------------------------------------------------

    @app.get(
        "/v1/items/{item_id}",
        response_model=ItemResponse,
    )
    def item_status(
        item_id: uuid.UUID,
    ):

        item = get_item(
            db_path,
            str(item_id),
        )

        if item is None:
            raise HTTPException(
                404,
                "Item not found",
            )

        return item_view(
            item,
            settings.data_dir,
        )

    # --------------------------------------------------------
    # GET ASSET
    # --------------------------------------------------------

    @app.get(
        "/v1/items/{item_id}/assets/{kind}"
    )
    def item_asset(
        item_id: uuid.UUID,
        kind: str,
    ):

        item = get_item(
            db_path,
            str(item_id),
        )

        if item is None:
            raise HTTPException(
                404,
                "Item not found",
            )

        allowed = (
            "original",
            "cutout",
            "review",
            "thumbnail",
        )

        if kind not in allowed:
            raise HTTPException(
                404,
                "Unknown asset kind",
            )

        if kind == "thumbnail":

            rel_path = thumbnail_path(
                item
            )

        else:

            field = {
                "original": "original_path",
                "cutout": "cutout_path",
                "review": "review_path",
            }[kind]

            rel_path = item[field]

        if not rel_path:
            raise HTTPException(
                404,
                "Asset is not available",
            )

        full_path = (
            settings.data_dir / rel_path
        ).resolve()

        data_root = (
            settings.data_dir.resolve()
        )

        if (
            not full_path.is_relative_to(data_root)
            or not full_path.is_file()
        ):
            raise HTTPException(
                404,
                "Asset unavailable",
            )

        mime_types = {
            "original": "image/jpeg",
            "cutout": "image/png",
            "review": "image/png",
            "thumbnail": "image/webp",
        }

        return FileResponse(
            full_path,
            media_type=mime_types[kind],
            headers={
                "Cache-Control": "no-store",
            },
        )

    # --------------------------------------------------------
    # RETRY
    # --------------------------------------------------------

    @app.post(
        "/v1/items/{item_id}/retry",
        response_model=ItemResponse,
    )
    def retry_item(
        item_id: uuid.UUID,
    ):

        item = get_item(
            db_path,
            str(item_id),
        )

        if item is None:
            raise HTTPException(
                404,
                "Item not found",
            )

        success = requeue(
            db_path,
            str(item_id),
        )

        if not success:
            raise HTTPException(
                409,
                "Item is already queued or processing",
            )

        item = get_item(
            db_path,
            str(item_id),
        )

        return item_view(
            item,
            settings.data_dir,
        )

    return app


# ============================================================
# APPLICATION INSTANCE
# ============================================================

app = create_app()
