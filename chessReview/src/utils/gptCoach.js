// Real GPT-4 chess coaching via backend API

// API URL
const API_URL = 'http://localhost:8080/api/coach';

export async function getMoveCoaching({ move, bestMove, evalScore, position, previousMoves }) {
  try {
    // Call our backend API
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        move,
        bestMove,
        evalScore,
        position,
        previousMoves
      })
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    return data.tip;
  } catch (error) {
    console.error('Error getting coaching tip:', error);
    // Simple fallback message if API fails
    return `Unable to connect to AI coach. The move played was ${move} and the engine suggested ${bestMove} with evaluation ${evalScore}.`;
  }
}
