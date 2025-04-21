import os
import openai
from typing import Dict, Any
import chess
import chess.pgn
from io import StringIO

# Initialize OpenAI client
openai.api_key = os.environ.get("OPENAI_API_KEY")

def get_openai_review(pgn_data: str, username: str = None) -> Dict[str, Any]:
    """
    Generate a comprehensive game review using OpenAI's GPT model
    
    Args:
        pgn_data: PGN notation of the chess game
        username: Optional username of the player to focus analysis on
        
    Returns:
        Dictionary containing summary and detailed analysis with markdown formatting
    """
    try:
        # Parse the PGN to extract basic game info
        pgn = StringIO(pgn_data.strip())
        game = chess.pgn.read_game(pgn)
        
        if not game:
            return {"summary": "Error: Unable to parse PGN data", "detailed": [], "markdown_format": True}
        
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
        
        # Create prompt for OpenAI
        prompt = f"""Analyze this chess game in PGN format and provide a detailed review.
        Game: {white} (White) vs {black} (Black), Result: {result}
        
        {player_perspective}
        
        Please provide your review in markdown format with appropriate formatting:
        1. Use # for main headings and ## for subheadings
        2. Use bullet points (* or -) for listing key points
        3. **Bold** important insights and move suggestions
        4. Use > blockquotes for highlighting important positions or principles
        5. Organize your analysis with clear section breaks
        
        Include the following sections:
        # Game Summary
        A brief overview of the key moments and result
        
        ## Opening Analysis
        Review of the opening choices and early game
        
        ## Middlegame Analysis
        Key tactical and strategic themes
        
        ## Endgame Analysis (if applicable)
        How the endgame was handled
        
        ## Critical Moments
        The most important decisions that affected the outcome
        
        ## Improvement Suggestions
        Specific advice for future games
        
        PGN:
        {pgn_data}
        """
        
        # Call OpenAI API
        response = openai.chat.completions.create(
            model="gpt-4-turbo",  # Use appropriate model based on your needs
            messages=[
                {"role": "system", "content": "You are a chess master providing insightful game analysis. Format your response in well-structured markdown with headings, bullet points, and emphasis for key insights. Provide thorough, educational reviews with practical advice that can be directly rendered in a web application."}, 
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
            max_tokens=2000
        )
        
        # Extract and return the generated review
        review_text = response.choices[0].message.content.strip()
        
        return {
            "summary": review_text,
            "player_focused": bool(player_perspective),
            "markdown_format": True
        }
        
    except Exception as e:
        # Handle any errors
        print(f"Error generating OpenAI review: {str(e)}")
        return {
            "summary": f"Error generating review: {str(e)}",
            "player_focused": False,
            "markdown_format": True
        }
