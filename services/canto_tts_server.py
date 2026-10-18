import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from shutil import copyfile
from tempfile import TemporaryDirectory

from canto_tts import CantoTTS
from fastapi import FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from starlette.responses import Response

logger = logging.getLogger("accessroute.canto_tts")


class SynthesisRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


def _dereference_model_cache() -> None:
    # Recent onnxruntime rejects model data files that are symlinks into the
    # Hugging Face blob cache, so replace them with real copies.
    from huggingface_hub.constants import HF_HUB_CACHE

    for snapshot in Path(HF_HUB_CACHE).glob("models--typangaa--canto-tts-nano/snapshots/*"):
        for path in snapshot.rglob("*"):
            if path.is_symlink():
                target = path.resolve()
                path.unlink()
                copyfile(target, path)


def _load_model() -> CantoTTS:
    try:
        return CantoTTS()
    except Exception:
        logger.warning("Model load failed; retrying with a de-linked model cache", exc_info=True)
        _dereference_model_cache()
        return CantoTTS()


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.tts = await asyncio.to_thread(_load_model)
    app.state.synthesis_lock = asyncio.Lock()
    logger.info("Self-hosted Cantonese TTS model is ready")
    yield


app = FastAPI(lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/synthesize")
async def synthesize(request: SynthesisRequest):
    async with app.state.synthesis_lock:
        try:
            with TemporaryDirectory(prefix="accessroute-canto-tts-") as directory:
                output = Path(directory) / "speech.wav"
                await run_in_threadpool(app.state.tts.synthesize, request.text, str(output))
                audio = await run_in_threadpool(output.read_bytes)
        except Exception as error:
            logger.exception("Cantonese speech synthesis failed")
            raise HTTPException(
                status_code=500,
                detail="Cantonese speech synthesis failed",
            ) from error

    if not audio:
        raise HTTPException(status_code=500, detail="Cantonese TTS returned empty audio")
    return Response(content=audio, media_type="audio/wav")
