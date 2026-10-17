import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from tempfile import TemporaryDirectory

from canto_tts import CantoTTS
from fastapi import FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from starlette.responses import Response

logger = logging.getLogger("accessroute.canto_tts")


class SynthesisRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.tts = await asyncio.to_thread(CantoTTS)
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
