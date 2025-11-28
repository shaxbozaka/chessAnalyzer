import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import BoardAnalysis, { MOVE_QUALITY, calculateAccuracy } from '../components/BoardAnalysis';
import GameSummary from '../components/GameSummary';

// Chess.com-style game rating based on average accuracy of both players
const getGameRating = (whiteAccuracy, blackAccuracy) => {
  if (whiteAccuracy === null || blackAccuracy === null) return null;

  const avgAccuracy = (parseFloat(whiteAccuracy) + parseFloat(blackAccuracy)) / 2;

  // Chess.com-style thresholds
  if (avgAccuracy >= 95) return { label: 'Brilliant Game!', color: '#1baca6', icon: '!!' };
  if (avgAccuracy >= 90) return { label: 'Great Game!', color: '#96bc4b', icon: '!' };
  if (avgAccuracy >= 80) return { label: 'Best Game', color: '#81b64c', icon: '' };
  if (avgAccuracy >= 70) return { label: 'Great Effort', color: '#5c8bb0', icon: '' };
  if (avgAccuracy >= 60) return { label: 'Good Game', color: '#f7c631', icon: '' };
  if (avgAccuracy >= 50) return { label: 'Ok Game', color: '#ffa459', icon: '' };
  return { label: 'Needs Work', color: '#fa412d', icon: '' };
};

const AnalysisPage = () => {
  const { year, month, gameId } = useParams();
  const location = useLocation();
  const [pgn, setPgn] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [analysis, setAnalysis] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
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
  const handleAnalysisComplete = useCallback((results) => {
    setAnalysis(results);
  }, []);

  // Handler for loading state changes
  const handleLoadingChange = useCallback((isLoading) => {
    setAnalyzing(isLoading);
  }, []);

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

  // Utility to extract PGN tags
  function parsePgnTags(pgn) {
    const tags = {};
    if (!pgn) return tags;
    const tagRegex = /\[(\w+)\s+"([^"]*)"\]/g;
    let match;
    while ((match = tagRegex.exec(pgn)) !== null) {
      tags[match[1]] = match[2];
    }
    return tags;
  }

  // Extract game details from PGN tags (these are authoritative)
  const tags = parsePgnTags(pgn);
  const white = tags.White || location.state?.username || 'Unknown';
  const black = tags.Black || location.state?.opponent || 'Unknown';
  const whiteElo = tags.WhiteElo || '';
  const blackElo = tags.BlackElo || '';
  const result = location.state?.result || tags.Result || 'Unknown';
  const opening = location.state?.opening || tags.Opening || tags.ECO || 'Unknown';
  const playerColor = location.state?.playerColor || (username && (username.toLowerCase() === (tags.White || '').toLowerCase() ? 'white' : 'black'));

  return (
    <div className="min-h-screen bg-[#1a1a1a]">
      <div className="w-full max-w-6xl mx-auto px-4 pt-4">
        {/* Compact header bar */}
        <div className="flex items-center gap-4 mb-4">
          <button
            onClick={handleBackClick}
            className="btn-nav text-sm"
          >
            ←
          </button>
            {!loading && !error && pgn && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-neutral-400">
                <span>
                  <span className="text-neutral-200 font-medium">{white}</span>
                  {whiteElo && <span className="text-neutral-500 ml-1">({whiteElo})</span>}
                  {analysis.length > 0 && !analyzing && (
                    <span className="text-green-400 ml-1">{calculateAccuracy(analysis, true)}%</span>
                  )}
                </span>
                <span>vs</span>
                <span>
                  <span className="text-neutral-200 font-medium">{black}</span>
                  {blackElo && <span className="text-neutral-500 ml-1">({blackElo})</span>}
                  {analysis.length > 0 && !analyzing && (
                    <span className="text-green-400 ml-1">{calculateAccuracy(analysis, false)}%</span>
                  )}
                </span>
                <span className="text-neutral-600">•</span>
                <span>{result}</span>
                <span className="text-neutral-600">•</span>
                <span>{opening}</span>
                {analysis.length > 0 && !analyzing && (() => {
                  const whiteAcc = calculateAccuracy(analysis, true);
                  const blackAcc = calculateAccuracy(analysis, false);
                  const rating = getGameRating(whiteAcc, blackAcc);
                  if (rating) {
                    return (
                      <>
                        <span className="text-neutral-600">•</span>
                        <span style={{ color: rating.color }} className="font-medium">
                          {rating.label}
                        </span>
                      </>
                    );
                  }
                  return null;
                })()}
                {analyzing && (
                  <>
                    <span className="text-neutral-600">•</span>
                    <span className="text-blue-400 flex items-center gap-1">
                      <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Analyzing...
                    </span>
                  </>
                )}
              </div>
            )}
        </div>

        {loading && <div className="text-center text-blue-400 py-8">Loading game...</div>}
        {error && <div className="text-center text-red-400 py-8">{error}</div>}
        {!loading && !error && pgn && (
          <div className="flex gap-4">
            <div className="flex-1">
              <BoardAnalysis
                pgn={pgn}
                username={username}
                onAnalysisComplete={handleAnalysisComplete}
                onLoadingChange={handleLoadingChange}
                playerColor={playerColor}
              />
            </div>
            {/* Game Summary Panel - shows after analysis is complete */}
            {analysis.length > 0 && !analyzing && (
              <div className="flex-shrink-0">
                <GameSummary
                  analysis={analysis}
                  pgn={pgn}
                  username={username}
                  whiteAccuracy={calculateAccuracy(analysis, true)}
                  blackAccuracy={calculateAccuracy(analysis, false)}
                  white={white}
                  black={black}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default AnalysisPage;
