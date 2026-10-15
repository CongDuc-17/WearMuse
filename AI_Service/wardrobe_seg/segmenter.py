
"""
WearMuseMeow AI Service
Local background removal engines.

Production:
    BiRefNet Standard via rembg + ONNX Runtime GPU

Testing:
    MockSegmenter

Features:
    - Windows CUDA / cuDNN DLL discovery
    - CUDA provider verification
    - Disable ONNX Runtime execution-provider fallback
    - Explicit CPU mode
    - Persistent DLL directory handles
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from PIL import Image, ImageDraw


# ============================================================
# CUDA / cuDNN CONFIGURATION
# ============================================================

# Windows requires these handles to remain alive.
_DLL_HANDLES = []

# Prevent duplicate initialization and PATH entries.
_CUDA_DLLS_CONFIGURED = False


def configure_cuda_dlls() -> None:
    """
    Configure CUDA and cuDNN runtime libraries.

    On Windows, NVIDIA pip packages usually install DLLs under:

        .venv/Lib/site-packages/nvidia/<package>/bin

    ONNX Runtime may need those paths during both session
    initialization and inference.

    This function should be called before rembg.new_session().
    """

    global _CUDA_DLLS_CONFIGURED

    if _CUDA_DLLS_CONFIGURED:
        return

    if sys.platform == "win32":
        nvidia_dir = (
            Path(sys.prefix)
            / "Lib"
            / "site-packages"
            / "nvidia"
        )

        cuda_packages = (
            "cuda_runtime",
            "cublas",
            "cufft",
            "cudnn",
            "nvrtc",
            "nvjitlink",
            "cusparse",
        )

        for package in cuda_packages:
            dll_dir = nvidia_dir / package / "bin"

            if not dll_dir.is_dir():
                continue

            dll_path = str(dll_dir)

            # Register DLL search path with Windows.
            handle = os.add_dll_directory(dll_path)
            _DLL_HANDLES.append(handle)

            # Some libraries also search via PATH.
            current_paths = os.environ.get("PATH", "").split(
                os.pathsep
            )

            if dll_path not in current_paths:
                os.environ["PATH"] = (
                    dll_path
                    + os.pathsep
                    + os.environ.get("PATH", "")
                )

    # Preload NVIDIA DLLs installed in the Python environment.
    import onnxruntime as ort

    if hasattr(ort, "preload_dlls"):
        try:
            ort.preload_dlls(directory="")
        except Exception as exc:
            raise RuntimeError(
                "Failed to preload CUDA/cuDNN libraries. "
                "Check NVIDIA runtime dependencies."
            ) from exc

    _CUDA_DLLS_CONFIGURED = True

    print("[cuda] Runtime libraries configured")


# ============================================================
# MOCK SEGMENTER
# ============================================================

class MockSegmenter:
    """
    TEST ONLY.

    Generates a synthetic rectangular alpha mask.
    Does NOT perform real AI background removal.
    """

    name = "mock-does-not-remove-background"

    def cutout(self, image: Image.Image) -> Image.Image:
        out = image.convert("RGBA")

        mask = Image.new(
            "L",
            image.size,
            0,
        )

        left = int(image.width * 0.17)
        top = int(image.height * 0.17)
        right = int(image.width * 0.83)
        bottom = int(image.height * 0.83)

        ImageDraw.Draw(mask).rectangle(
            (left, top, right, bottom),
            fill=255,
        )

        out.putalpha(mask)

        return out


# ============================================================
# REAL REMBG SEGMENTER
# ============================================================

class RembgSegmenter:
    """
    Real background removal using rembg.

    Default:
        model: birefnet-general
        provider: cuda

    Example:
        segmenter = RembgSegmenter(
            provider="cuda",
            model="birefnet-general",
        )

        result = segmenter.cutout(image)
    """

    def __init__(
        self,
        *,
        provider: str = "cuda",
        model: str = "birefnet-general",
    ) -> None:

        # ----------------------------------------------------
        # 1. Validate provider
        # ----------------------------------------------------

        if provider not in {"cuda", "cpu"}:
            raise ValueError(
                "provider must be 'cuda' or 'cpu'"
            )

        self.provider = provider
        self.name = model

        # ----------------------------------------------------
        # 2. Configure CUDA libraries
        # ----------------------------------------------------

        if provider == "cuda":
            configure_cuda_dlls()

        import onnxruntime as ort

        # ----------------------------------------------------
        # 3. Select execution providers
        # ----------------------------------------------------

        if provider == "cuda":

            available = ort.get_available_providers()

            if "CUDAExecutionProvider" not in available:
                raise RuntimeError(
                    "CUDAExecutionProvider is unavailable. "
                    "Check onnxruntime-gpu installation."
                )

            providers = [
                "CUDAExecutionProvider",
                "CPUExecutionProvider",
            ]

        else:
            providers = [
                "CPUExecutionProvider",
            ]

        # ----------------------------------------------------
        # 4. Initialize rembg session
        # ----------------------------------------------------

        from rembg import new_session, remove

        self._remove = remove

        try:
            self._session = new_session(
                model,
                providers=providers,
            )

        except Exception as exc:
            raise RuntimeError(
                f"Failed to initialize segmentation model "
                f"'{model}' with provider '{provider}'."
            ) from exc

        # ----------------------------------------------------
        # 5. Verify actual execution providers
        # ----------------------------------------------------

        inner_session = self._session.inner_session

        actual_providers = inner_session.get_providers()

        print(
            f"[model] {model}; "
            f"active providers: {actual_providers}"
        )

        if provider == "cuda":

            if "CUDAExecutionProvider" not in actual_providers:
                raise RuntimeError(
                    "CUDA was requested but the model "
                    f"initialized with {actual_providers}. "
                    "Check CUDA/cuDNN runtime."
                )

            # ------------------------------------------------
            # 6. Disable runtime execution-provider fallback
            # ------------------------------------------------

            # Prevent ONNX Runtime from switching the entire
            # inference session to CPU after a CUDA failure.
            #
            # CPUExecutionProvider remains registered for
            # individual operators not supported by CUDA.

            inner_session.disable_fallback()

            print(
                "[cuda] ONNX Runtime fallback disabled"
            )

        print(
            f"[segmenter] Model '{model}' initialized"
        )

    # ========================================================
    # BACKGROUND REMOVAL
    # ========================================================

    def cutout(
        self,
        image: Image.Image,
    ) -> Image.Image:
        """
        Remove image background.

        Args:
            image: PIL Image.

        Returns:
            PIL RGBA image with transparent background.

        Raises:
            RuntimeError: If segmentation inference fails.
        """

        if not isinstance(image, Image.Image):
            raise TypeError(
                "cutout() expects a PIL.Image.Image"
            )

        try:
            result = self._remove(
                image,
                session=self._session,
            )

            return result.convert("RGBA")

        except Exception as exc:
            raise RuntimeError(
                f"Background removal failed "
                f"using model '{self.name}' "
                f"on provider '{self.provider}'."
            ) from exc
