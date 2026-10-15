
from dataclasses import dataclass
from pathlib import Path

import os


@dataclass(frozen=True)
class Settings:

    data_dir: Path

    max_upload_mb: int = 12
    max_image_pixels: int = 12_000_000
    max_side: int = 1600

    max_attempts: int = 2
    stale_seconds: int = 900

    @classmethod
    def from_env(cls) -> "Settings":

        return cls(
            data_dir=Path(
                os.environ.get(
                    "WARDROBE_DATA_DIR",
                    "./local_data",
                )
            ).resolve(),

            max_upload_mb=int(
                os.environ.get(
                    "WARDROBE_MAX_UPLOAD_MB",
                    "12",
                )
            ),

            max_image_pixels=int(
                os.environ.get(
                    "WARDROBE_MAX_PIXELS",
                    "12000000",
                )
            ),

            max_side=int(
                os.environ.get(
                    "WARDROBE_MAX_SIDE",
                    "1600",
                )
            ),
        )

    def ensure(self) -> None:

        self.data_dir.mkdir(
            parents=True,
            exist_ok=True,
        )

        folders = (
            "originals",
            "raw_cutouts",
            "cutouts",
            "thumbnails",
            "review",
        )

        for folder in folders:

            (
                self.data_dir / folder
            ).mkdir(
                parents=True,
                exist_ok=True,
            )
