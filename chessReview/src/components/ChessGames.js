import React, { useState, useEffect, Fragment, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

const ChessGames = () => {
  const [username, setUsername] = useState('');
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // New state variables for pagination
  const [archives, setArchives] = useState([]);
  const [currentArchiveIndex, setCurrentArchiveIndex] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [pageLoading, setPageLoading] = useState(false);
  const navigate = useNavigate();
  
  // Reference to observe the last game element
  const observer = useRef();
  const lastGameElementRef = useCallback(node => {
    if (loading || pageLoading) return;
    if (observer.current) observer.current.disconnect();
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore) {
        loadMoreGames();
      }
    }, { threshold: 0.1 });
    if (node) observer.current.observe(node);
  }, [loading, pageLoading, hasMore]);

  // Load saved username and fetch games on component mount
  useEffect(() => {
    const savedUsername = localStorage.getItem('ai-chess-coach-username');
    if (savedUsername) {
      setUsername(savedUsername);
      // Allow component to update with the username first
      setTimeout(() => {
        fetchGames(savedUsername);
      }, 100);
    }
  }, []);

  const fetchGames = async (usernameToFetch = null) => {
    const userToFetch = usernameToFetch || username;
    
    if (!userToFetch.trim()) {
      setError('Please enter a Chess.com username');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setGames([]);
      // Reset pagination state
      setArchives([]);
      setCurrentArchiveIndex(0);
      setHasMore(true);

      // First, fetch the archives (available months)
      const archivesResponse = await fetch(`https://api.chess.com/pub/player/${userToFetch}/games/archives`);
      
      if (!archivesResponse.ok) {
        throw new Error(`User not found or API error: ${archivesResponse.status}`);
      }
      
      const archivesData = await archivesResponse.json();
      
      if (!archivesData.archives || archivesData.archives.length === 0) {
        throw new Error('No game archives found for this user');
      }
      
      // Store all archives for pagination
      const allArchives = archivesData.archives.reverse(); // Reverse to start with most recent
      setArchives(allArchives);
      
      // Get the most recent month's games
      const initialGames = await fetchArchiveGames(allArchives[0], userToFetch);
      
      if (initialGames.length === 0) {
        // If the most recent month has no games, try to find games in older months
        let foundGames = false;
        let index = 1;
        
        while (!foundGames && index < allArchives.length) {
          const olderGames = await fetchArchiveGames(allArchives[index], userToFetch);
          if (olderGames.length > 0) {
            setGames(olderGames);
            setCurrentArchiveIndex(index);
            foundGames = true;
          }
          index++;
        }
        
        if (!foundGames) {
          throw new Error('No games found in any archive');
        }
      } else {
        setGames(initialGames);
      }
      
      localStorage.setItem('ai-chess-coach-username', userToFetch);

    } catch (err) {
      setError(err.message);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  };

  // New function to fetch games from a specific archive
  const fetchArchiveGames = async (archiveUrl, userToFetch) => {
    try {
      const [year, month] = archiveUrl.split('/').slice(-2);
      const gamesResponse = await fetch(archiveUrl);
      
      if (!gamesResponse.ok) {
        throw new Error(`Failed to fetch games: ${gamesResponse.status}`);
      }
      
      const gamesData = await gamesResponse.json();
      
      if (!gamesData.games || gamesData.games.length === 0) {
        return []; // No games in this archive
      }
      
      // Add year/month to each game for routing and sort by end_time in descending order
      const archiveGames = gamesData.games
        .map(g => ({ ...g, year, month }))
        .sort((a, b) => b.end_time - a.end_time); // Sort newest first
      
      return archiveGames;
    } catch (err) {
      console.error('Error fetching archive games:', err);
      return [];
    }
  };

  // Function to load more games when scrolling
  const loadMoreGames = async () => {
    if (pageLoading || !hasMore || archives.length === 0) return;
    
    const nextArchiveIndex = currentArchiveIndex + 1;
    
    if (nextArchiveIndex >= archives.length) {
      setHasMore(false);
      return;
    }
    
    setPageLoading(true);
    
    try {
      const nextArchiveUrl = archives[nextArchiveIndex];
      const newGames = await fetchArchiveGames(nextArchiveUrl, username);
      
      if (newGames.length === 0) {
        // Skip empty archives and move to the next one
        setCurrentArchiveIndex(nextArchiveIndex);
        setPageLoading(false); // Important to set this to false before trying the next archive
        loadMoreGames(); // Try the next archive
        return;
      }
      
      setGames(prevGames => [...prevGames, ...newGames]);
      setCurrentArchiveIndex(nextArchiveIndex);
    } catch (err) {
      console.error('Error loading more games:', err);
    } finally {
      setPageLoading(false);
    }
  };

  // Extract opening name from PGN
  const extractOpeningFromPGN = (pgn) => {
    // Try to extract the opening name from PGN
    const openingMatch = pgn.match(/\[Opening "([^"]+)"\]/);
    if (openingMatch && openingMatch[1]) {
      return openingMatch[1];
    }
    
    // If Opening tag is not found, try ECO tag
    const ecoMatch = pgn.match(/\[ECO "([^"]+)"\]/);
    if (ecoMatch && ecoMatch[1]) {
      return `ECO: ${ecoMatch[1]}`;
    }
    
    return 'Opening not available';
  };

  // Format date
  const formatDate = (timestamp) => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
  };

  const handleAnalyze = (game) => {
    // Use game.uuid if available, else fallback to game.url or index
    let gameId = game.uuid || (game.url ? game.url.split('/').pop() : game.end_time);
    
    // Determine if the user was white or black
    const isWhite = game.white.username.toLowerCase() === username.toLowerCase();
    const playerColor = isWhite ? 'white' : 'black';
    
    navigate(`/analysis/${game.year}/${game.month}/${gameId}`, {
      state: {
        pgn: game.pgn,
        username,
        playerColor
      },
    });
  };

  return (
    <Fragment>
      <div>
        <div className="mb-8">
          <div className="flex flex-col sm:flex-row items-center justify-center space-y-2 sm:space-y-0 sm:space-x-2">
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && fetchGames()}
              placeholder="Enter Chess.com username"
              className="px-4 py-2 w-full sm:w-64 rounded-lg border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 transition-colors duration-200"
            />
            <button
              onClick={() => fetchGames()}
              disabled={loading}
              className="px-4 py-2 w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-sm transition duration-300 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 disabled:opacity-50"
            >
              {loading ? 'Loading...' : 'Fetch Games'}
            </button>
          </div>

          {error && (
            <div className="mt-4 p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-lg text-center">
              {error}
            </div>
          )}
        </div>

        {loading && (
          <div className="flex justify-center mt-6 mb-6">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500"></div>
          </div>
        )}

        <div className="flex flex-col items-center w-full gap-4">
          {games.length > 0 && games.map((game, index) => {
            // Determine if the user was white or black
            const isWhite = game.white.username.toLowerCase() === username.toLowerCase();
            const playerColor = isWhite ? 'white' : 'black';
            const opponentColor = isWhite ? 'black' : 'white';
            const opponent = game[opponentColor].username;
            
            // Determine game result
            let result = 'draw';
            let resultText = 'Draw';
            
            if (game.white.result === 'win') {
              result = isWhite ? 'win' : 'loss';
              resultText = isWhite ? 'Win' : 'Loss';
            } else if (game.black.result === 'win') {
              result = isWhite ? 'loss' : 'win';
              resultText = isWhite ? 'Loss' : 'Win';
            }

            // Get opening
            const opening = game.pgn ? extractOpeningFromPGN(game.pgn) : 'Opening not available';

            // Add ref to the last item for intersection observer
            const isLastElement = index === games.length - 1;

            return (
              <div 
                key={game.uuid || game.url || index}
                ref={isLastElement ? lastGameElementRef : null}
                className="w-full max-w-2xl bg-white dark:bg-gray-800 rounded-xl shadow-card hover:shadow-card-hover transition-shadow duration-300 overflow-hidden border border-gray-100 dark:border-gray-700 flex flex-col sm:flex-row items-center sm:items-stretch p-4 sm:p-6 gap-4"
              >
                <div className="flex-1 flex flex-col justify-center">
                  <div className={`text-lg font-semibold mb-3 ${result === 'win' ? 'text-win' : result === 'loss' ? 'text-loss' : 'text-draw'}`}>
                    {resultText}
                  </div>
                  <div className="mb-1 font-medium dark:text-gray-200">Opponent: {opponent}</div>
                  <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Date: {formatDate(game.end_time)}</div>
                  <div className="text-sm text-gray-600 dark:text-gray-400 italic">{opening}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-500 mt-3">
                    Played as: {playerColor.charAt(0).toUpperCase() + playerColor.slice(1)}
                  </div>
                </div>
                <div className="flex items-center justify-end w-full sm:w-auto">
                  <button
                    className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 py-2 rounded-lg shadow-sm transition"
                    onClick={() => handleAnalyze(game)}
                  >
                    Analyze
                  </button>
                </div>
              </div>
            );
          })}
          {!loading && games.length === 0 && !error && (
            <div className="text-center text-gray-500 dark:text-gray-400 mt-10">
              Enter a Chess.com username and click "Fetch Games" to see recent games
            </div>
          )}
          
          {/* Loading indicator for pagination */}
          {pageLoading && (
            <div className="flex justify-center my-6">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            </div>
          )}
          
          {/* End of games message */}
          {!hasMore && games.length > 0 && !pageLoading && (
            <div className="text-center text-gray-500 dark:text-gray-400 my-6">
              End of games history
            </div>
          )}
        </div>
      </div>
    </Fragment>
  );
};

export default ChessGames;
