import os
from openai import OpenAI
from typing import Dict, Any
import chess
import chess.pgn
from io import StringIO


def _move_number(ply):
    try:
        ply = int(ply)
    except (TypeError, ValueError):
        return "?"
    move_no = (ply + 1) // 2
    return f"{move_no}." if ply % 2 == 1 else f"{move_no}..."


def _format_engine_summary(analysis):
    if not analysis:
        return "No engine analysis was provided."

    counts = {}
    for move in analysis:
        quality = (move.get("quality") or move.get("label") or "unknown").lower()
        counts[quality] = counts.get(quality, 0) + 1

    critical_qualities = {"brilliant", "miss", "inaccuracy", "mistake", "blunder"}
    critical_moves = []
    for move in analysis:
        quality = (move.get("quality") or move.get("label") or "").lower()
        if quality not in critical_qualities:
            continue

        ply = move.get("ply")
        if ply is None:
            try:
                ply = analysis.index(move) + 1
            except ValueError:
                ply = "?"
        played = move.get("move") or move.get("playedSan") or "?"
        best = move.get("best_move") or move.get("bestMove")
        cp_loss = move.get("cp_loss", move.get("cpLoss"))
        expected_loss = move.get("expected_loss", move.get("expectedLoss"))
        comment = move.get("comment") or ""

        detail = f"- {_move_number(ply)} {played}: {quality}"
        if expected_loss is not None:
            detail += f", expected-score loss {expected_loss} percentage points"
        elif cp_loss is not None:
            detail += f", {cp_loss} centipawn loss"
        if best:
            detail += f", engine preferred {best}"
        if comment:
            detail += f". Existing note: {comment}"
        critical_moves.append(detail)

    count_text = ", ".join(f"{quality}: {count}" for quality, count in sorted(counts.items()))
    critical_text = "\n".join(critical_moves[:14]) if critical_moves else "No major engine-labeled turning points."
    return f"""Engine move-quality counts: {count_text}

Critical engine-labeled moves:
{critical_text}
"""


def get_openai_review(pgn_data: str, username: str = None, analysis=None) -> Dict[str, Any]:
    """
    Generate a comprehensive game review using OpenAI's GPT model
    
    Args:
        pgn_data: PGN notation of the chess game
        username: Optional username of the player to focus analysis on
        
    Returns:
        Dictionary containing summary and detailed analysis with markdown formatting
    """
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OpenAI API key is not configured.")

    # Parse the PGN to extract basic game info
    pgn = StringIO(pgn_data.strip())
    game = chess.pgn.read_game(pgn)

    if not game:
        raise ValueError("Unable to parse PGN data.")

    # Extract game metadata
    white = game.headers.get("White", "Unknown")
    black = game.headers.get("Black", "Unknown")
    result = game.headers.get("Result", "*")

    # Determine which player to focus on if username is provided
    player_perspective = ""
    if username:
        if username.lower() in white.lower():
            player_perspective = f"Focus on advice for {white} (White)."
        elif username.lower() in black.lower():
            player_perspective = f"Focus on advice for {black} (Black)."

    engine_summary = _format_engine_summary(analysis)

    # Create prompt for OpenAI
    prompt = f"""Analyze this chess game in PGN format and provide a detailed review.
    Game: {white} (White) vs {black} (Black), Result: {result}

    {player_perspective}

    Use this engine analysis as ground truth for critical moments. Do not invent tactics that conflict with it:
    {engine_summary}

    Please provide your review in markdown format with appropriate formatting:
    1. Use # for main headings and ## for subheadings
    2. Use bullet points (* or -) for listing key points
    3. **Bold** important insights and move suggestions
    4. Use > blockquotes for highlighting important positions or principles
    5. Organize your analysis with clear section breaks

    Include the following sections:
    # Game Summary
    A brief overview of the key moments and result, grounded in the engine analysis

    ## Opening Analysis
    Review of the opening choices and early game

    ## Middlegame Analysis
    Key tactical and strategic themes

    ## Endgame Analysis (if applicable)
    How the endgame was handled

    ## Critical Moments
    The most important engine-identified decisions that affected the outcome

    ## Improvement Suggestions
    Specific advice for future games

    PGN:
    {pgn_data}
    """

    client = OpenAI(api_key=api_key)
    response = client.chat.completions.create(
        model=os.environ.get("OPENAI_REVIEW_MODEL", "gpt-4-turbo"),
        messages=[
            {"role": "system", "content": "You are a chess master providing insightful game analysis. Format your response in well-structured markdown with headings, bullet points, and emphasis for key insights. Provide thorough, educational reviews with practical advice that can be directly rendered in a web application."},
            {"role": "user", "content": prompt}
        ],
        temperature=0.7,
        max_tokens=2000
    )

    review_text = response.choices[0].message.content.strip()

    return {
        "summary": review_text,
        "player_focused": bool(player_perspective),
        "markdown_format": True
    }
