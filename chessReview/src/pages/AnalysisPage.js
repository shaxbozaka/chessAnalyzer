import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import BoardAnalysis, { calculateAccuracy } from '../components/BoardAnalysis';
import GameSummary from '../components/GameSummary';

const USERNAME_STORAGE_KEY = 'chess-game-review-username';
const LEGACY_USERNAME_STORAGE_KEY = 'ai-chess-coach-username';

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
        const user = localStorage.getItem(USERNAME_STORAGE_KEY) || localStorage.getItem(LEGACY_USERNAME_STORAGE_KEY);
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
  const analysisReady = analysis.length > 0 && !analyzing;
  const whiteAccuracy = analysisReady ? calculateAccuracy(analysis, true) : null;
  const blackAccuracy = analysisReady ? calculateAccuracy(analysis, false) : null;
  const rating = analysisReady ? getGameRating(whiteAccuracy, blackAccuracy) : null;

  return (
    <div className="min-h-screen bg-[#151515] text-neutral-100">
      <header className="border-b border-neutral-800 bg-[#151515]/95">
        <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={handleBackClick}
              className="btn-nav h-11 w-11 shrink-0 px-0 text-lg"
              aria-label="Back to games"
            >
              ←
            </button>
            {!loading && !error && pgn && (
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-base font-semibold">
                  <span className="truncate text-neutral-100">
                    {white}
                    {whiteElo && <span className="ml-1 text-neutral-500">({whiteElo})</span>}
                    {whiteAccuracy && <span className="ml-2 text-sm text-green-400">{whiteAccuracy}%</span>}
                  </span>
                  <span className="text-neutral-600">vs</span>
                  <span className="truncate text-neutral-100">
                    {black}
                    {blackElo && <span className="ml-1 text-neutral-500">({blackElo})</span>}
                    {blackAccuracy && <span className="ml-2 text-sm text-green-400">{blackAccuracy}%</span>}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-neutral-400">
                  <span>{result}</span>
                  <span className="text-neutral-700">•</span>
                  <span>{opening}</span>
                </div>
              </div>
            )}
          </div>

          {!loading && !error && pgn && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {rating && (
                <span
                  className="inline-flex items-center gap-2 font-semibold"
                  style={{ color: rating.color }}
                >
                  <span className="h-2 w-2 rounded-full bg-current" aria-hidden="true" />
                  {rating.label}
                </span>
              )}
              {analyzing && (
                <span className="flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-blue-300">
                  <svg className="h-3.5 w-3.5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Analyzing
                </span>
              )}
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1500px] px-5 py-5">
        {loading && <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-8 text-center text-blue-300">Loading game...</div>}
        {error && <div className="rounded-lg border border-red-900/70 bg-red-950/40 p-8 text-center text-red-300">{error}</div>}
        {!loading && !error && pgn && (
          <div className="flex flex-col gap-5 2xl:flex-row">
            <div className="min-w-0 flex-1">
              <BoardAnalysis
                pgn={pgn}
                username={username}
                onAnalysisComplete={handleAnalysisComplete}
                onLoadingChange={handleLoadingChange}
                playerColor={playerColor}
              />
            </div>
            {/* Game Summary Panel - shows after analysis is complete */}
            {analysisReady && (
              <aside className="shrink-0">
                <GameSummary
                  analysis={analysis}
                  whiteAccuracy={whiteAccuracy}
                  blackAccuracy={blackAccuracy}
                  white={white}
                  black={black}
                />
              </aside>
            )}
          </div>
        )}
      </main>
    </div>
  );
};

export default AnalysisPage;
