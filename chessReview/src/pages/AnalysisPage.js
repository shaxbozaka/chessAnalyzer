import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import BoardAnalysis from '../components/BoardAnalysis';
import GameSummary from '../components/GameSummary';

const AnalysisPage = () => {
  const { year, month, gameId } = useParams();
  const location = useLocation();
  const [pgn, setPgn] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [analysis, setAnalysis] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    // If PGN was passed via route state, use it directly
    if (location.state?.pgn) {
      setPgn(location.state.pgn);
      setUsername(location.state.username || '');
      setLoading(false);
      return;
    }

    const fetchGame = async () => {
      try {
        setLoading(true);
        setError(null);
        // Assume username is in localStorage (set on Home fetch)
        const user = localStorage.getItem('ai-chess-coach-username');
        setUsername(user || '');
        const res = await fetch(`https://api.chess.com/pub/player/${user}/games/${year}/${month}`);
        if (!res.ok) throw new Error('Failed to fetch games');
        const data = await res.json();
        const game = data.games.find(g => (g.uuid === gameId || (g.url && g.url.endsWith(gameId)) || g.end_time.toString() === gameId));
        if (!game) throw new Error('Game not found');
        setPgn(game.pgn);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    fetchGame();
  }, [year, month, gameId, location.state]);

  // Handler to receive analysis results from BoardAnalysis
  const handleAnalysisComplete = (results) => {
    setAnalysis(results);
  };

  // Handle back button click
  const handleBackClick = () => {
    // Try to go back in history first
    try {
      // Check if we can go back in history
      if (window.history.length > 1) {
        navigate(-1);
      } else {
        // If no history, redirect to home page
        navigate('/');
      }
    } catch (error) {
      // Fallback to home page if any error occurs
      navigate('/');
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center bg-gray-50 dark:bg-gray-900 pb-10 transition-colors duration-200">
      <div className="w-full max-w-5xl mt-8 px-4">
        <button 
          onClick={handleBackClick} 
          className="mb-4 px-4 py-2 rounded bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 transition-colors duration-200"
        >
          ← Back
        </button>
        <h2 className="text-2xl font-bold mb-4 text-center text-gray-800 dark:text-gray-100">Game Analysis</h2>
        {loading && <div className="text-center text-blue-500 dark:text-blue-400">Loading game...</div>}
        {error && <div className="text-center text-red-500 dark:text-red-400">{error}</div>}
        {!loading && !error && pgn && (
          <>
            <BoardAnalysis 
              pgn={pgn} 
              username={username} 
              onAnalysisComplete={handleAnalysisComplete}
              playerColor={location.state?.playerColor}
            />
            {analysis.length > 0 && (
              <GameSummary 
                analysis={analysis} 
                pgn={pgn} 
                username={username} 
              />
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default AnalysisPage;
