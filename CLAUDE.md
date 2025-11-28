# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chess Analyzer is a full-stack application that analyzes chess games from Chess.com using Stockfish evaluation and OpenAI GPT reviews. The project has a React frontend (chessReview) and Python FastAPI backend (chessBackend).

## Development Commands

### Backend (Python/FastAPI)

```bash
cd chessBackend
python -m venv .venv  # Create virtual environment (first time only)
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -r requirements.txt
python server.py  # Runs on port 8080 by default
```

### Frontend (React)

```bash
cd chessReview
npm install  # First time only
npm start  # Development server on port 3000
npm run build  # Production build
npm test  # Run tests
```

### Docker Deployment

```bash
docker-compose up -d --build  # Build and start containers
docker-compose logs -f  # View logs
docker-compose down  # Stop containers
```

## Environment Variables

Required environment variables (create `.env` file in project root based on `.env.example`):
- `OPENAI_API_KEY`: Required for GPT-powered game reviews
- `STOCKFISH_PATH`: Path to Stockfish binary (defaults to `/usr/games/stockfish` in Docker)
- `BOOK_PATH`: Path to opening book file (defaults to `/app/bookfish.bin` in Docker)
- `PORT`: Backend server port (defaults to 8080)

## Architecture

### Backend (chessBackend/)

The backend is built with FastAPI and provides two main endpoints:

**POST /analyze**: Analyzes a chess game using Stockfish
- Uses parallel processing via `ProcessPoolExecutor` to evaluate all positions simultaneously
- Evaluates move quality: best, good, inaccuracy, mistake, blunder, brilliant, book, forced
- Detects opening book moves using Polyglot format
- Implements Chess.com-style brilliant move detection (sacrifices that are the only move avoiding significant eval loss)

**POST /review**: Generates GPT-powered game review
- Uses OpenAI API to create markdown-formatted analysis
- Can focus on a specific player if username provided
- Returns structured review with opening/middlegame/endgame analysis

**Key modules:**
- `chess_analyzer.py`: Core analysis logic with parallel Stockfish evaluation
- `gpt_review.py`: OpenAI integration for natural language reviews
- `server.py`: FastAPI server with CORS middleware

### Frontend (chessReview/src/)

React application with routing:
- `/`: Main page to fetch and list Chess.com games
- `/analysis/:year/:month/:gameId`: Detailed game analysis view

**Key utilities:**
- `chessApi.js`: Fetches games from Chess.com public API
- `gameReview.js`: Processes game analysis results
- `gptCoach.js`: Handles GPT review integration
- `stockfishWASM.js`: Client-side Stockfish via WebAssembly
- `ThemeContext.js`: Dark mode theme management

**Components:**
- `ChessGames.js`: Game list and selection
- `BoardAnalysis.js`: Interactive board with move analysis
- `GameSummary.js`: Summary statistics and insights
- `AnalysisPage.js`: Main analysis page orchestrating components

## Important Implementation Details

### Parallel Position Evaluation

The analyzer evaluates all game positions in parallel using multiprocessing (chess_analyzer.py:146-166). Each worker process creates its own Stockfish instance configured with limited strength (ELO 1800, depth 12) for faster analysis. Results are cached by FEN and reused.

### Move Quality Classification

Move quality is determined by centipawn loss (chess_analyzer.py:34-65):
- Book moves and forced moves have special classifications
- Brilliant moves require: sacrifice + only move preventing 150+ centipawn loss + eval remains positive
- Standard thresholds: ≤20cp (best), ≤50cp (good), ≤100cp (inaccuracy), ≤300cp (mistake), >300cp (blunder)

### API Communication

Frontend calls backend via axios. Backend expects PGN data in POST body. The docker-compose setup exposes backend on port 8080 (maps to internal 5000) and frontend on port 3000.

## Docker Architecture

Two-container setup with shared network (chess-network):
- Frontend container serves React app and proxies API calls to backend
- Backend container runs FastAPI with uvicorn, includes Stockfish and opening book
- Environment variables passed through docker-compose.yml
