from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import os

# Import local module with a renamed import to avoid confusion
import chess_analyzer
import gpt_review

app = FastAPI(title="Chess Analysis API")

# Configure CORS more explicitly
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allow all methods
    allow_headers=["*"],  # Allow all headers
    expose_headers=["*"],  # Expose all headers
    max_age=86400,  # Cache preflight requests for 24 hours
)

class PGNRequest(BaseModel):
    pgn_data: str
    stockfish_path: Optional[str] = os.environ.get("STOCKFISH_PATH")  # Use environment variable as default
    book_path: Optional[str] = os.environ.get("BOOK_PATH")  # Use environment variable as default

class ReviewRequest(BaseModel):
    pgn: str
    username: Optional[str] = None

class MoveAnalysis(BaseModel):
    ply: int
    move: str
    quality: str
    is_book: bool
    comment: Optional[str] = None
    eval: Optional[float] = None

class AnalysisResponse(BaseModel):
    moves: List[MoveAnalysis]

class ReviewResponse(BaseModel):
    summary: str
    player_focused: bool

@app.post("/api/analyze", response_model=AnalysisResponse)
@app.post("/analyze", response_model=AnalysisResponse)
async def analyze_chess_game(request: PGNRequest):
    try:
        # Call the analyze_game function from our local chess_analyzer.py module
        analysis = chess_analyzer.analyze_game(
            request.pgn_data, 
            request.stockfish_path,
            request.book_path
        )
        return {"moves": analysis}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

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
        review_result = gpt_review.get_openai_review(
            pgn_data=request.pgn,
            username=request.username
        )
        
        return review_result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/")
async def root():
    return {"message": "Chess Analysis API is running"}

if __name__ == "__main__":
    import uvicorn
    # Use port 8080 to match docker-compose configuration
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=True)