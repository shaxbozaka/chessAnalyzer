import React, { useEffect, useState, useCallback } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Move quality labels and colors (Chess.com style)
const MOVE_QUALITY = {
  brilliant: { label: 'Brilliant', color: 'bg-cyan-500 text-white', squareColor: 'rgba(6, 182, 212, 0.5)' },
  great: { label: 'Great Move', color: 'bg-blue-400 text-white', squareColor: 'rgba(96, 165, 250, 0.5)' },
  best: { label: 'Best', color: 'bg-lime-500 text-white', squareColor: 'rgba(132, 204, 22, 0.5)' },
  good: { label: 'Good Move', color: 'bg-green-500 text-white', squareColor: 'rgba(34, 197, 94, 0.5)' },
  inaccuracy: { label: 'Inaccuracy', color: 'bg-yellow-500 text-white', squareColor: 'rgba(234, 179, 8, 0.5)' },
  mistake: { label: 'Mistake', color: 'bg-orange-500 text-white', squareColor: 'rgba(249, 115, 22, 0.5)' },
  blunder: { label: 'Blunder', color: 'bg-red-600 text-white', squareColor: 'rgba(220, 38, 38, 0.5)' },
  ordinary: { label: 'Ordinary', color: 'bg-gray-300 text-gray-700', squareColor: 'rgba(156, 163, 175, 0.3)' },
  book: { label: 'Book Move', color: 'bg-amber-300 text-amber-800', squareColor: 'rgba(252, 211, 77, 0.5)' },
  forced: { label: 'Forced Move', color: 'bg-gray-500 text-white', squareColor: 'rgba(107, 114, 128, 0.5)' }
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
        
        // Check if response contains moves array
        if (data && data.moves && Array.isArray(data.moves)) {
          // Process the moves as they come from the API
          const analysisResults = data.moves.map((item, index) => {
            const moveObj = moves[index] || {};
            const quality = item.quality ? item.quality.toLowerCase() : 'ordinary';
            
            return {
              move: moveObj,
              playedSan: moveObj.san || '',
              bestSan: '', 
              eval: '0.0',
              label: quality in MOVE_QUALITY ? quality : 'ordinary',
              comment: item.comment || ''
            };
          });
          
          setAnalysis(analysisResults);
          
          // Store the summary directly
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
    const isSelected = idx === currentMove - 1;
    const quality = analysis && idx < analysis.length ? analysis[idx]?.label : null;
    const style = quality ? MOVE_QUALITY[quality]?.color : 'bg-gray-200 text-gray-700';
    
    return isSelected ? style : style;
  };

  // Get current move quality information
  const currentMoveInfo = () => {
    if (currentMove === 0 || !analysis || analysis.length < currentMove) return null;
    
    const moveAnalysis = analysis[currentMove - 1];
    if (!moveAnalysis) return null;
    
    const quality = moveAnalysis.label;
    const moveText = moves[currentMove - 1]?.san || '';
    const moveNumber = Math.floor((currentMove - 1) / 2) + 1;
    const isWhiteMove = (currentMove - 1) % 2 === 0;
    const fullMoveText = `${moveNumber}${isWhiteMove ? '.' : '...'} ${moveText}`;
    
    return {
      quality,
      colorClass: MOVE_QUALITY[quality]?.color || '',
      label: MOVE_QUALITY[quality]?.label || '',
      text: fullMoveText
    };
  };

  // MoveQualityStats component (receives analysis as a prop)
  const MoveQualitySummary = ({ analysis }) => {
    if (!analysis || analysis.length === 0) return null;
    
    // Count moves by quality and side
    const counts = {
      white: {
        brilliant: 0,
        great: 0,
        best: 0,
        good: 0,
        inaccuracy: 0,
        mistake: 0,
        blunder: 0,
        ordinary: 0
      },
      black: {
        brilliant: 0,
        great: 0,
        best: 0,
        good: 0,
        inaccuracy: 0,
        mistake: 0,
        blunder: 0,
        ordinary: 0
      }
    };
    
    // Count the moves by quality and side
    analysis.forEach((item, index) => {
      if (!item || !item.label) return;
      
      const side = index % 2 === 0 ? 'white' : 'black';
      const quality = item.label.toLowerCase();
      
      // Make sure the quality is one we track
      if (counts[side].hasOwnProperty(quality)) {
        counts[side][quality]++;
      }
    });
    
    // Helper to render a quality row
    const renderQualityRow = (quality) => {
      const whiteCount = counts.white[quality] || 0;
      const blackCount = counts.black[quality] || 0;
      const totalCount = whiteCount + blackCount;
      
      if (totalCount === 0) return null;
      
      // Extract the background color class without text color
      const bgColorClass = MOVE_QUALITY[quality]?.color.split(' ')[0] || '';
      
      return (
        <div className="flex items-center gap-2 py-1" key={quality}>
          <div className={`w-5 h-5 ${bgColorClass} rounded`}></div>
          <span className="text-lg">{quality}</span>
          <span className="ml-auto flex gap-4">
            <span>{whiteCount}</span>
            <span>{blackCount}</span>
          </span>
        </div>
      );
    };
    
    return (
      <div className="bg-gray-900 text-white p-4 rounded-lg w-[300px] dark:bg-gray-800">
        <h2 className="text-2xl font-bold text-center mb-4">Move Quality Summary</h2>
        
        <div className="flex justify-between mb-2">
          <span className="text-gray-400">White</span>
          <span className="text-gray-400">Black</span>
        </div>
        
        {renderQualityRow('brilliant')}
        {renderQualityRow('great')}
        {renderQualityRow('best')}
        {renderQualityRow('good')}
        {renderQualityRow('inaccuracy')}
        {renderQualityRow('mistake')}
        {renderQualityRow('blunder')}
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
          
          {/* Current move quality indicator */}
          {currentMoveInfo() && (
            <div className={`mb-2 py-1 px-3 rounded-t-lg inline-block ${currentMoveInfo().colorClass}`}>
              {currentMoveInfo().label}: {currentMoveInfo().text}
            </div>
          )}
          
          {/* Chessboard */}
          <div className="w-[min(80vw,500px)] h-[min(80vw,500px)] rounded overflow-hidden shadow-lg bg-gray-50 dark:bg-gray-800">
            <Chessboard
              id="analysis-board"
              position={position}
              boardWidth={500}
              arePiecesDraggable={false}
              animationDuration={300}
              customSquareStyles={getHighlightSquare()}
              boardOrientation={playerColor === 'black' ? 'black' : 'white'}
              customDarkSquareStyle={{ backgroundColor: '#769656' }} 
              customLightSquareStyle={{ backgroundColor: '#eeeed2' }}
            />
          </div>
          
          {/* Navigation buttons */}
          <div className="flex justify-center mt-4 gap-2">
            <button 
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 rounded text-gray-700 dark:text-gray-200 transition-colors duration-200"
              onClick={() => goToMove(currentMove - 1)}
              disabled={currentMove === 0}
            >
              Previous
            </button>
            <button
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 rounded text-gray-700 dark:text-gray-200 transition-colors duration-200"
              onClick={() => goToMove(0)}
            >
              Start
            </button>
            <button
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 rounded text-gray-700 dark:text-gray-200 transition-colors duration-200"
              onClick={() => goToMove(moves.length)}
            >
              End
            </button>
            <button
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 rounded text-gray-700 dark:text-gray-200 transition-colors duration-200"
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
                    className={`${getMoveStyle(idx)} px-2 py-1 rounded text-xs font-medium`}
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
        
        {/* Move quality stats */}
        {analysis.length > 0 && (
          <div className="w-full lg:w-auto">
            <MoveQualitySummary analysis={analysis} />
          </div>
        )}
      </div>
    </div>
  );
};

export default BoardAnalysis;