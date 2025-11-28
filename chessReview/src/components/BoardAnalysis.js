import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Move quality labels and colors (Chess.com exact colors)
export const MOVE_QUALITY = {
  brilliant: { label: 'Brilliant', color: 'text-white', bgColor: '#1baca6', squareColor: 'rgba(27, 172, 166, 0.5)' },
  great: { label: 'Great Move', color: 'text-white', bgColor: '#5c8bb0', squareColor: 'rgba(92, 139, 176, 0.5)' },
  best: { label: 'Best', color: 'text-white', bgColor: '#96bc4b', squareColor: 'rgba(150, 188, 75, 0.5)' },
  good: { label: 'Good Move', color: 'text-white', bgColor: '#81b64c', squareColor: 'rgba(129, 182, 76, 0.5)' },
  inaccuracy: { label: 'Inaccuracy', color: 'text-black', bgColor: '#f7c631', squareColor: 'rgba(247, 198, 49, 0.5)' },
  mistake: { label: 'Mistake', color: 'text-white', bgColor: '#ffa459', squareColor: 'rgba(255, 164, 89, 0.5)' },
  blunder: { label: 'Blunder', color: 'text-white', bgColor: '#fa412d', squareColor: 'rgba(250, 65, 45, 0.5)' },
  ordinary: { label: 'Ordinary', color: 'text-gray-700', bgColor: '#d1d5db', squareColor: 'rgba(156, 163, 175, 0.3)' },
  book: { label: 'Book Move', color: 'text-white', bgColor: '#a88865', squareColor: 'rgba(168, 136, 101, 0.5)' },
  forced: { label: 'Forced Move', color: 'text-white', bgColor: '#97af8b', squareColor: 'rgba(151, 175, 139, 0.5)' }
};

const BoardAnalysis = ({ pgn, username, onAnalysisComplete, playerColor }) => {
  // Core state
  const [chess] = useState(new Chess());
  const [position, setPosition] = useState('start');
  const [moves, setMoves] = useState([]);
  const [currentMove, setCurrentMove] = useState(0);
  
  // Analysis state
  const [analysis, setAnalysis] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [gameReview, setGameReview] = useState({ content: '', markdown: false });
  
  // UI state
  const [reviewLoading, setReviewLoading] = useState(false);
  const boardContainerRef = useRef(null);
  const [boardWidth, setBoardWidth] = useState(null);

  // Responsive board width using ResizeObserver
  useEffect(() => {
    if (!boardContainerRef.current) return;
    const container = boardContainerRef.current;
    function updateBoardWidth() {
      const containerWidth = container.offsetWidth;
      setBoardWidth(Math.max(200, Math.min(containerWidth, 500)));
    }
    updateBoardWidth();
    let resizeObserver = new window.ResizeObserver(updateBoardWidth);
    resizeObserver.observe(container);
    window.addEventListener('resize', updateBoardWidth);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateBoardWidth);
    };
  }, []);

  // Load the PGN data when it changes
  useEffect(() => {
    if (!pgn) return;
    
    // Reset state
    setAnalysis([]);
    setCurrentMove(0);
    setError(null);
    setGameReview({ content: '', markdown: false });
    
    try {
      // Store the original PGN (important to preserve exactly as received from Chess.com)
      console.log('Received PGN from Chess.com:', pgn);
      
      // Load the game
      chess.loadPgn(pgn);
      
      // Extract move history
      const history = chess.history({ verbose: true });
      setMoves(history);
      setPosition('start');
      
      // No automatic analysis - wait for user to click the button
    } catch (err) {
      console.error('Error loading PGN:', err);
      setError(`Error loading PGN: ${err.message}`);
    }
  }, [pgn, chess]);

  // Fetch analysis from the API using JSON format
  const fetchAnalysis = useCallback(() => {
    if (!pgn) {
      setError('PGN data is required for analysis');
      return;
    }
    
    setLoading(true);
    setError(null);
    
    // Make sure PGN is in the right format
    const pgnToSend = pgn.trim();
    
    fetch('/api/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ pgn_data: pgnToSend })
    })
      .then(response => {
        if (!response.ok) {
          throw new Error(`Network response was not OK: ${response.status}`);
        }
        return response.json();
      })
      .then(data => {
        console.log('Analysis response:', data);
        if (data && data.moves && Array.isArray(data.moves)) {
          const analysisResults = data.moves.map((item, index) => {
            const moveObj = moves[index] || {};
            // Only use moveObj.san or item.move (no item.san)
            const playedSan = moveObj.san || item.move || '';
            const quality = item.quality ? item.quality.toLowerCase() : 'ordinary';
            return {
              move: moveObj,
              playedSan,
              bestSan: '',
              eval: item.eval !== null && item.eval !== undefined ? item.eval.toFixed(2) : null,
              label: quality in MOVE_QUALITY ? quality : 'ordinary',
              comment: item.comment || ''
            };
          });
          setAnalysis(analysisResults);
          if (data.summary) {
            setGameReview({
              content: data.summary,
              markdown: data.markdown_format || false
            });
          }
        } else {
          throw new Error('Response does not contain the expected moves array');
        }
      })
      .catch(error => {
        console.error('Analysis error:', error);
        setError(error.message);
        setAnalysis([]);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [pgn, moves]);

  // Fetch game review using JSON format
  const fetchReview = useCallback(() => {
    if (!pgn) {
      setError('PGN is required for review');
      return;
    }
    
    setReviewLoading(true);
    
    fetch('/api/review', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        pgn: pgn.trim(),
        username: username || undefined
      })
    })
      .then(response => {
        if (!response.ok) {
          throw new Error(`Network response was not OK: ${response.status}`);
        }
        return response.json();
      })
      .then(data => {
        console.log('Review response:', data);
        
        if (data && data.summary) {
          setGameReview({
            content: data.summary,
            markdown: data.markdown_format || false
          });
          if (onAnalysisComplete && analysis.length > 0) {
            onAnalysisComplete(analysis, data.summary);
          }
        } else {
          setGameReview({
            content: 'No review available from API.',
            markdown: false
          });
        }
      })
      .catch(error => {
        console.error('Review error:', error);
        setGameReview({
          content: `Error fetching review: ${error.message}`,
          markdown: false
        });
      })
      .finally(() => {
        setReviewLoading(false);
      });
  }, [pgn, username, analysis, onAnalysisComplete]);

  // Fetch analysis when pgn and moves are available
  useEffect(() => {
    if (pgn && moves.length > 0 && !analysis.length && !loading) {
      fetchAnalysis();
    }
  }, [pgn, moves.length, analysis.length]);

  // Update board position when current move changes
  useEffect(() => {
    if (currentMove === 0) {
      setPosition('start'); // Initial position
      return;
    }
    
    // Apply moves up to current position
    const game = new Chess();
    for (let i = 0; i < currentMove && i < moves.length; i++) {
      game.move(moves[i]);
    }
    
    setPosition(game.fen());
  }, [currentMove, moves]);

  // Navigation functions
  const goToMove = (moveNumber) => {
    setCurrentMove(Math.max(0, Math.min(moveNumber, moves.length)));
  };

  // Handle keyboard navigation with arrow keys
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Left arrow key - go to previous move
      if (e.key === 'ArrowLeft' && currentMove > 0) {
        goToMove(currentMove - 1);
      }
      // Right arrow key - go to next move
      else if (e.key === 'ArrowRight' && currentMove < moves.length) {
        goToMove(currentMove + 1);
      }
    };

    // Add event listener
    document.addEventListener('keydown', handleKeyDown);

    // Clean up event listener when component unmounts
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [currentMove, moves.length]);

  // Calculate square highlight for current move
  const getHighlightSquare = () => {
    if (currentMove === 0 || !moves[currentMove - 1]) return {};
    
    const moveQuality = analysis && analysis.length >= currentMove 
      ? analysis[currentMove - 1]?.label 
      : null;
    
    if (!moveQuality) return {};
    
    const square = moves[currentMove - 1].to;
    const color = MOVE_QUALITY[moveQuality]?.squareColor || '';
    
    return { [square]: { backgroundColor: color } };
  };

  // Get style for a move button
  const getMoveStyle = (idx) => {
    const quality = analysis && idx < analysis.length ? analysis[idx]?.label : null;
    const qualityInfo = quality ? MOVE_QUALITY[quality] : null;

    return {
      backgroundColor: qualityInfo?.bgColor || '#e5e7eb',
      color: qualityInfo?.bgColor ? (qualityInfo.color === 'text-black' ? '#000' : '#fff') : '#374151'
    };
  };

  // Get current move quality information
  const currentMoveInfo = () => {
    if (currentMove === 0 || !analysis || analysis.length < currentMove) return null;

    const moveAnalysis = analysis[currentMove - 1];
    if (!moveAnalysis) return null;

    const quality = moveAnalysis.label;
    const qualityInfo = MOVE_QUALITY[quality];
    const moveText = moves[currentMove - 1]?.san || '';
    const moveNumber = Math.floor((currentMove - 1) / 2) + 1;
    const isWhiteMove = (currentMove - 1) % 2 === 0;
    const fullMoveText = `${moveNumber}${isWhiteMove ? '.' : '...'} ${moveText}`;

    return {
      quality,
      bgColor: qualityInfo?.bgColor || '#e5e7eb',
      textColor: qualityInfo?.color === 'text-black' ? '#000' : '#fff',
      label: qualityInfo?.label || '',
      text: fullMoveText,
      comment: moveAnalysis.comment || '',
      eval: moveAnalysis.eval
    };
  };

  // MoveQualityStats component (receives analysis and loading as props)
  const MoveQualitySummary = ({ analysis, loading }) => {
    return (
      <div className="bg-gray-900 text-white p-4 rounded-lg w-[300px] dark:bg-gray-800 flex flex-col items-center justify-center min-h-[200px]">
        <h2 className="text-2xl font-bold text-center mb-4">Move Quality Summary</h2>
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full">
            <svg className="animate-spin h-8 w-8 text-blue-400 mb-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span className="text-blue-300">Analyzing moves...</span>
          </div>
        ) : (
          <>
            {(!analysis || analysis.length === 0) ? (
              <div className="text-gray-400 text-center">No analysis available.</div>
            ) : (
              <>
                <div className="flex items-center gap-2 py-1 w-full mb-2">
                  <div className="w-5 h-5"></div>
                  <span className="text-lg flex-1"></span>
                  <span className="flex gap-4">
                    <span className="w-12 text-center text-gray-400">White</span>
                    <span className="w-12 text-center text-gray-400">Black</span>
                  </span>
                </div>
                {['brilliant','great','best','good','book','inaccuracy','mistake','blunder','forced'].map(quality => {
                  // Count moves by quality and side
                  const counts = {white: 0, black: 0};
                  analysis.forEach((item, idx) => {
                    if (item && item.label && item.label.toLowerCase() === quality) {
                      const side = idx % 2 === 0 ? 'white' : 'black';
                      counts[side]++;
                    }
                  });
                  const total = counts.white + counts.black;
                  if (total === 0) return null;
                  const qualityInfo = MOVE_QUALITY[quality];
                  return (
                    <div className="flex items-center gap-2 py-1 w-full" key={quality}>
                      <div className="w-5 h-5 rounded" style={{ backgroundColor: qualityInfo?.bgColor }}></div>
                      <span className="text-lg capitalize flex-1">{quality}</span>
                      <span className="flex gap-4">
                        <span className="w-12 text-center">{counts.white}</span>
                        <span className="w-12 text-center">{counts.black}</span>
                      </span>
                    </div>
                  );
                })}
              </>
            )}
          </>
        )}
      </div>
    );
  };

  // Render the component
  return (
    <div className="flex flex-col items-center">
      {error && (
        <div className="w-full max-w-[600px] bg-red-100 dark:bg-red-900/30 border border-red-400 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}
      
      <div className="flex flex-col lg:flex-row gap-8 items-start">
        {/* Board and controls */}
        <div className="w-full lg:w-auto">
          {/* Analysis status indicator */}
          {loading && (
            <div className="w-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 p-2 rounded mb-2 text-center">
              <div className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-5 w-5 text-blue-600 dark:text-blue-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>Preparing move analysis...</span>
              </div>
            </div>
          )}
          
          {/* Current move quality indicator with comment */}
          {currentMoveInfo() && (
            <div className="mb-2">
              <div
                className="py-1 px-3 rounded-t-lg inline-block"
                style={{ backgroundColor: currentMoveInfo().bgColor, color: currentMoveInfo().textColor }}
              >
                {currentMoveInfo().label}: {currentMoveInfo().text}
                {currentMoveInfo().eval && (
                  <span className="ml-2 opacity-80">
                    (Eval: {currentMoveInfo().eval > 0 ? '+' : ''}{currentMoveInfo().eval})
                  </span>
                )}
              </div>
              {currentMoveInfo().comment && (
                <div className="mt-1 p-2 bg-gray-100 dark:bg-gray-700 rounded text-sm text-gray-700 dark:text-gray-300">
                  {currentMoveInfo().comment}
                </div>
              )}
            </div>
          )}
          
          {/* Chessboard */}
          <div ref={boardContainerRef} className="w-full max-w-[500px] aspect-square mx-auto">
            {boardWidth ? (
              <Chessboard
                id="analysis-board"
                position={position}
                boardWidth={boardWidth}
                arePiecesDraggable={false}
                animationDuration={300}
                customSquareStyles={getHighlightSquare()}
                boardOrientation={playerColor === 'black' ? 'black' : 'white'}
                customDarkSquareStyle={{ backgroundColor: '#769656' }}
                customLightSquareStyle={{ backgroundColor: '#eeeed2' }}
              />
            ) : (
              <div className="flex items-center justify-center w-full h-full min-h-[200px]">
                <svg className="animate-spin h-8 w-8 text-blue-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </div>
            )}
          </div>
          
          {/* Navigation buttons */}
          <div className="navigation-buttons flex justify-center mt-4 gap-2">
            <button 
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded text-gray-700"
              onClick={() => goToMove(currentMove - 1)}
              disabled={currentMove === 0}
            >
              Previous
            </button>
            <button
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded text-gray-700"
              onClick={() => goToMove(0)}
            >
              Start
            </button>
            <button
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded text-gray-700"
              onClick={() => goToMove(moves.length)}
            >
              End
            </button>
            <button
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded text-gray-700"
              onClick={() => goToMove(currentMove + 1)}
              disabled={currentMove >= moves.length}
            >
              Next
            </button>
          </div>
          
          {/* List of moves */}
          <div className="mt-4 p-3 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 shadow transition-colors duration-200">
            <p className="font-medium text-center text-gray-700 dark:text-gray-300 mb-2">Moves</p>
            <div className="flex flex-wrap gap-1">
              {moves.map((move, idx) => {
                const moveNumber = Math.floor(idx / 2) + 1;
                const isWhite = idx % 2 === 0;
                
                // If first move of the pair, show move number
                const prefix = isWhite ? `${moveNumber}. ` : '';
                
                return (
                  <button
                    key={idx}
                    className="px-2 py-1 rounded text-xs font-medium"
                    style={getMoveStyle(idx)}
                    onClick={() => goToMove(idx + 1)}
                  >
                    {prefix}{move.san}
                  </button>
                );
              })}
            </div>
          </div>
          
          {/* Request review button */}
          {analysis.length > 0 && !gameReview.content && (
            <div className="mt-6">
              <button
                className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded w-full"
                onClick={fetchReview}
                disabled={reviewLoading}
              >
                {reviewLoading ? 'Generating Review...' : 'Get Game Review'}
              </button>
            </div>
          )}
          
          {/* Game review */}
          {gameReview.content && (
            <div className="mt-6 bg-white dark:bg-gray-800 p-4 rounded-lg shadow border border-gray-200 dark:border-gray-700">
              <h3 className="text-xl font-bold mb-3 text-blue-800 dark:text-blue-400">Game Review</h3>
              <div className="prose dark:prose-invert prose-sm max-w-none">
                {gameReview.markdown ? (
                  <ReactMarkdown 
                    remarkPlugins={[remarkGfm]}
                  >
                    {gameReview.content}
                  </ReactMarkdown>
                ) : (
                  gameReview.content.split('\n').map((line, i) => (
                    <p key={i}>{line}</p>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
        {/* Move quality stats/modal always visible */}
        <div className="w-full lg:w-auto">
          <MoveQualitySummary analysis={analysis} loading={loading} />
        </div>
      </div>
    </div>
  );
};

export default BoardAnalysis;