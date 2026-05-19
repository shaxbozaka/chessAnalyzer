import asyncio
import logging
import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool
from typing import Any, List, Optional

# Import local module with a renamed import to avoid confusion
import chess_analyzer
import gpt_review

app = FastAPI(title="Chess Analysis API")
logger = logging.getLogger(__name__)


def _env_int(name, default, minimum=1):
    try:
        value = int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default
    return max(minimum, value)


def _cors_origins():
    raw = os.environ.get("CORS_ORIGINS", "*")
    if raw == "*":
        return ["*"]
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


MAX_PGN_CHARS = _env_int("MAX_PGN_CHARS", 200_000)
MAX_FEN_CHARS = 120
ANALYSIS_CONCURRENCY = _env_int("ANALYSIS_CONCURRENCY", 1)
analysis_semaphore = asyncio.Semaphore(ANALYSIS_CONCURRENCY)

# Configure CORS more explicitly
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Cache-Control"],
    max_age=86400,
)

class StrictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PGNRequest(StrictRequest):
    pgn_data: str = Field(..., min_length=1, max_length=MAX_PGN_CHARS)


class PositionRequest(StrictRequest):
    fen: str = Field(..., min_length=1, max_length=MAX_FEN_CHARS)


class MoveRequest(StrictRequest):
    fen: str = Field(..., min_length=1, max_length=MAX_FEN_CHARS)
    move: str = Field(..., min_length=2, max_length=16)


class ReviewRequest(StrictRequest):
    pgn: str = Field(..., min_length=1, max_length=MAX_PGN_CHARS)
    username: Optional[str] = None
    analysis: Optional[List[dict[str, Any]]] = None


class EngineMove(BaseModel):
    move: str
    move_uci: str
    eval: Optional[float] = None
    eval_cp: Optional[int] = None


class MoveAnalysis(BaseModel):
    ply: int
    move: str
    quality: str
    is_book: bool
    comment: Optional[str] = None
    eval: Optional[float] = None
    eval_before: Optional[float] = None  # Eval before move (for win probability calculation)
    best_move: Optional[str] = None
    cp_loss: Optional[int] = None  # Centipawn loss for accuracy calculation
    expected_loss: Optional[float] = None
    top_moves: Optional[List[EngineMove]] = None

class AnalysisResponse(BaseModel):
    moves: List[MoveAnalysis]

class PositionResponse(BaseModel):
    fen: str
    eval: Optional[float] = None
    best_move: Optional[str] = None
    best_move_uci: Optional[str] = None
    top_moves: Optional[List[EngineMove]] = None

class ReviewResponse(BaseModel):
    summary: str
    player_focused: bool

@app.post("/api/analyze", response_model=AnalysisResponse)
@app.post("/analyze", response_model=AnalysisResponse)
async def analyze_chess_game(request: PGNRequest):
    try:
        async with analysis_semaphore:
            analysis = await run_in_threadpool(chess_analyzer.analyze_game, request.pgn_data)
        return {"moves": analysis}
    except chess_analyzer.AnalysisInputError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except chess_analyzer.AnalysisConfigError as e:
        logger.exception("Analysis service is not configured")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.exception("Unexpected analysis failure")
        raise HTTPException(status_code=500, detail="Unexpected analysis failure.") from e

@app.post("/api/position", response_model=PositionResponse)
@app.post("/position", response_model=PositionResponse)
async def analyze_position(request: PositionRequest):
    try:
        async with analysis_semaphore:
            return await run_in_threadpool(chess_analyzer.analyze_position, request.fen)
    except chess_analyzer.AnalysisInputError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except chess_analyzer.AnalysisConfigError as e:
        logger.exception("Analysis service is not configured")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.exception("Unexpected position analysis failure")
        raise HTTPException(status_code=500, detail="Unexpected position analysis failure.") from e


@app.post("/api/move", response_model=MoveAnalysis)
@app.post("/move", response_model=MoveAnalysis)
async def analyze_candidate_move(request: MoveRequest):
    try:
        async with analysis_semaphore:
            return await run_in_threadpool(
                chess_analyzer.analyze_candidate_move,
                request.fen,
                request.move
            )
    except chess_analyzer.AnalysisInputError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except chess_analyzer.AnalysisConfigError as e:
        logger.exception("Analysis service is not configured")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.exception("Unexpected move analysis failure")
        raise HTTPException(status_code=500, detail="Unexpected move analysis failure.") from e


@app.post("/api/review", response_model=ReviewResponse)
@app.post("/review", response_model=ReviewResponse)
async def review_chess_game(request: ReviewRequest):
    try:
        # Check for API key
        if not os.environ.get("OPENAI_API_KEY"):
            raise HTTPException(
                status_code=500, 
                detail="OpenAI API key not configured. Please set the OPENAI_API_KEY environment variable."
            )
        
        # Generate review using OpenAI
        review_result = await run_in_threadpool(
            gpt_review.get_openai_review,
            request.pgn,
            request.username,
            request.analysis
        )
        
        return review_result
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("OpenAI review generation failed")
        raise HTTPException(status_code=502, detail="OpenAI review generation failed.") from e

@app.get("/")
async def root():
    return {"message": "Chess Analysis API is running"}

if __name__ == "__main__":
    import uvicorn
    # Use port 8080 to match docker-compose configuration
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=True)
