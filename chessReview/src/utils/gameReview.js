import React, { useEffect, useState } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import getGameReview from '../utils/gameReview';

  /**
   * Renders a chessboard with a given PGN and fetches an AI game review.
   *
   * @param {string} pgn - The PGN of the game to analyze
   * @param {string} username - The username to determine the player color
   * @returns {JSX.Element} A React element displaying the chessboard and AI game review
   */
const BoardAnalysis = ({ pgn, username }) => {
  const [error, setError] = useState(null);
  const [review, setReview] = useState('');
  const [loading, setLoading] = useState(false);
  const [moves, setMoves] = useState([]);
  const [position, setPosition] = useState('start');

  // Parse the PGN into moves and initial position
  useEffect(() => {
    if (!pgn) return;
    try {
      const chess = new Chess();
      chess.reset();
      chess.loadPgn(pgn);
      setError(null);
      setMoves(chess.history({ verbose: true }).map(m => m.san));
      setPosition(chess.fen());
    } catch (e) {
      console.error('Invalid PGN:', e);
      setError(`Invalid PGN: ${e.message}`);
    }
  }, [pgn]);

  // Fetch AI game review once moves are available
  useEffect(() => {
    if (moves.length === 0) return;
    const fetchReview = async () => {
      setLoading(true);
      try {
        // Determine player color from PGN tags if needed; default to 'white'
        let playerColor = 'white';
        const whiteTag = pgn.match(/\[White "([^"]+)"\]/);
        const blackTag = pgn.match(/\[Black "([^"]+)"\]/);
        if (whiteTag?.[1]?.toLowerCase().includes(username.toLowerCase())) {
          playerColor = 'white';
        } else if (blackTag?.[1]?.toLowerCase().includes(username.toLowerCase())) {
          playerColor = 'black';
        }
        const text = await getGameReview({
          moves,
          evaluations: [], 
          pgn,
          playerColor
        });
        setReview(text);
      } catch (e) {
        console.error('Error fetching game review:', e);
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    fetchReview();
  }, [moves, pgn, username]);

  return (
    <div className="flex flex-col items-center gap-6">
      {error && <div className="text-red-500">{error}</div>}
      <div className="w-full max-w-[500px]">
        <Chessboard
          position={position}
          boardWidth={350}
          arePiecesDraggable={false}
          animationDuration={200}
        />
      </div>
      {loading && (
        <div className="text-gray-600">Loading AI game review...</div>
      )}
      {review && (
        <div className="mt-4 p-4 bg-white rounded shadow">
          <h2 className="text-lg font-bold mb-2">AI Game Review</h2>
          <div className="prose">{review.split('\n').map((line, i) => (
            <p key={i}>{line}</p>
          ))}</div>
        </div>
      )}
    </div>
  );
};

export default BoardAnalysis;
