import { useEffect, useState, useCallback, useRef } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';

// Move quality colors (Chess.com style)
const QUALITY_COLORS = {
  brilliant: '#1baca6',
  great: '#5c8bb0',
  excellent: '#96bc4b',
  best: '#96bc4b',
  good: '#81b64c',
  inaccuracy: '#f7c631',
  mistake: '#ffa459',
  miss: '#e86b5a',
  blunder: '#fa412d',
  book: '#a88865',
  forced: '#97af8b'
};

// Chess.com-style move quality icons (SVG components)
const QualityIcon = ({ quality, size = 24 }) => {
  const iconStyle = {
    width: size,
    height: size,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 'bold',
    fontSize: size * 0.5,
    color: 'white',
    flexShrink: 0,
    boxShadow: '0 2px 4px rgba(0,0,0,0.4)',
    border: '2px solid rgba(255,255,255,0.3)',
  };

  const q = quality?.toLowerCase();
  const bgColor = QUALITY_COLORS[q] || '#666';

  // Star icon for brilliant
  if (q === 'brilliant') {
    return (
      <div style={{ ...iconStyle, backgroundColor: bgColor }}>
        <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6} fill="white">
          <path d="M12 2L9.19 8.63L2 9.24L7.46 13.97L5.82 21L12 17.27L18.18 21L16.54 13.97L22 9.24L14.81 8.63L12 2Z"/>
        </svg>
      </div>
    );
  }

  // Checkmark for best/excellent/good
  if (q === 'best' || q === 'excellent' || q === 'good') {
    return (
      <div style={{ ...iconStyle, backgroundColor: bgColor }}>
        <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6} fill="white">
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
        </svg>
      </div>
    );
  }

  // Book icon
  if (q === 'book') {
    return (
      <div style={{ ...iconStyle, backgroundColor: bgColor }}>
        <svg viewBox="0 0 24 24" width={size * 0.55} height={size * 0.55} fill="white">
          <path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z"/>
        </svg>
      </div>
    );
  }

  // Forced move icon (circle checkmark)
  if (q === 'forced') {
    return (
      <div style={{ ...iconStyle, backgroundColor: bgColor }}>
        <svg viewBox="0 0 24 24" width={size * 0.55} height={size * 0.55} fill="white">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
        </svg>
      </div>
    );
  }

  // Text-based icons for others
  const textIcons = {
    great: '!',
    inaccuracy: '?!',
    mistake: '?',
    miss: 'x',
    blunder: '??',
  };

  if (textIcons[q]) {
    return (
      <div style={{ ...iconStyle, backgroundColor: bgColor }}>
        {textIcons[q]}
      </div>
    );
  }

  // Fallback for any other quality - show checkmark
  return (
    <div style={{ ...iconStyle, backgroundColor: bgColor }}>
      <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6} fill="white">
        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
      </svg>
    </div>
  );
};

// Only these get colored in move list
const HIGHLIGHT_QUALITIES = ['brilliant', 'inaccuracy', 'mistake', 'miss', 'blunder'];
// These get highlighted on the board with background color and icon
const BOARD_HIGHLIGHT_QUALITIES = ['brilliant', 'great', 'excellent', 'best', 'good', 'inaccuracy', 'mistake', 'miss', 'blunder', 'book', 'forced'];

// Convert centipawns to win probability using Chess.com-style formula
// Chess.com uses a stricter sigmoid curve than Lichess
// This gives lower win probabilities for small advantages, matching their accuracy better
const cpToWinPercent = (cp) => {
  if (cp === null || cp === undefined) return 50;
  // Convert from pawns to centipawns and cap extreme values
  cp = Math.max(-1000, Math.min(1000, cp * 100));
  // Chess.com uses a steeper curve (0.004 vs Lichess's 0.00368)
  // This makes small errors count more
  return 50 + 50 * (2 / (1 + Math.exp(-0.004 * cp)) - 1);
};

// Calculate per-move accuracy from win probability change
// Chess.com-style formula: more punishing than Lichess
// Lower coefficient means mistakes hurt more
const winProbToMoveAccuracy = (winProbLoss) => {
  // winProbLoss should be positive when the move made things worse
  if (winProbLoss <= 0) return 100; // Move didn't lose any win probability
  // Chess.com uses a stricter decay: coefficient of 0.06 instead of 0.04354
  // This gives lower accuracy for the same win probability loss
  const accuracy = 103.1668 * Math.exp(-0.06 * winProbLoss) - 3.1669;
  return Math.max(0, Math.min(100, accuracy));
};

// Calculate accuracy using Chess.com-style algorithm
// Based on win probability changes with stricter penalties
export const calculateAccuracy = (analysis, isWhite) => {
  const playerMoves = analysis.filter((_, idx) => (idx % 2 === 0) === isWhite);
  if (playerMoves.length === 0) return null;

  const moveAccuracies = [];

  playerMoves.forEach((move) => {
    const quality = move.label?.toLowerCase() || move.quality?.toLowerCase() || 'good';
    // Skip book moves - they're theory, not player decisions
    if (quality === 'book') return;

    // Get evaluations in pawns (eval is already in pawns from backend)
    const evalBefore = move.evalBefore ?? move.eval_before;
    const evalAfter = move.eval ?? move.evaluation;

    if (evalBefore !== null && evalBefore !== undefined &&
        evalAfter !== null && evalAfter !== undefined) {
      // Convert evals to win probability
      const winBefore = cpToWinPercent(evalBefore);
      const winAfter = cpToWinPercent(evalAfter);

      // Calculate win probability loss from the moving player's perspective
      let winProbLoss;
      if (isWhite) {
        // White wants high eval. Loss = how much win% dropped
        winProbLoss = winBefore - winAfter;
      } else {
        // Black wants low eval. From Black's view: win% = 100 - White's win%
        // Black's loss = winAfter - winBefore (if eval increased, Black lost win%)
        winProbLoss = winAfter - winBefore;
      }

      // Calculate move accuracy using Chess.com-style formula
      const moveAccuracy = winProbToMoveAccuracy(winProbLoss);
      moveAccuracies.push(moveAccuracy);
    } else {
      // Fallback: use cp_loss with estimated win prob conversion
      let cpLoss = move.cpLoss ?? move.cp_loss ?? estimateCpLoss(quality);
      cpLoss = Math.min(Math.max(0, cpLoss), 800);
      // Chess.com counts errors more heavily: 0.15 factor vs Lichess's 0.12
      const approxWinProbLoss = cpLoss * 0.15;
      const moveAccuracy = winProbToMoveAccuracy(approxWinProbLoss);
      moveAccuracies.push(moveAccuracy);
    }
  });

  if (moveAccuracies.length === 0) return '100.0';

  // Use harmonic mean with a stricter weighting for bad moves
  // Chess.com's algorithm penalizes bad moves more heavily
  const harmonicMean = moveAccuracies.length /
    moveAccuracies.reduce((sum, acc) => sum + 1 / Math.max(acc, 0.1), 0);

  return harmonicMean.toFixed(1);
};

// Estimate centipawn loss from quality category (fallback)
const estimateCpLoss = (quality) => {
  const estimates = {
    brilliant: 0,
    great: 5,
    best: 0,
    excellent: 5,
    good: 15,
    book: 0,
    forced: 0,
    inaccuracy: 60,
    mistake: 150,
    miss: 100,
    blunder: 350
  };
  return estimates[quality] ?? 20;
};

export const MOVE_QUALITY = Object.fromEntries(
  Object.entries(QUALITY_COLORS).map(([k, v]) => [k, {
    label: k.charAt(0).toUpperCase() + k.slice(1),
    bgColor: v,
    squareColor: v.replace(')', ', 0.5)').replace('rgb', 'rgba').replace('#', 'rgba(').replace(/([a-f0-9]{2})([a-f0-9]{2})([a-f0-9]{2})/i, (_, r, g, b) => `${parseInt(r,16)}, ${parseInt(g,16)}, ${parseInt(b,16)}, 0.5)`)
  }])
);

const BoardAnalysis = ({ pgn, username, onAnalysisComplete, onLoadingChange, playerColor }) => {
  const [chess] = useState(new Chess());
  const [position, setPosition] = useState('start');
  const [moves, setMoves] = useState([]);
  const [currentMove, setCurrentMove] = useState(0);
  const [analysis, setAnalysis] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const boardRef = useRef(null);
  const moveListRef = useRef(null);
  const [showBestMove, setShowBestMove] = useState(false);

  // What-If mode
  const [exploreMode, setExploreMode] = useState(false);
  const [exploreChess, setExploreChess] = useState(null);
  const [exploreMoves, setExploreMoves] = useState([]);
  const [exploreHistory, setExploreHistory] = useState([]); // FEN history for navigation
  const [lastMoveEval, setLastMoveEval] = useState(null);
  const [evalLoading, setEvalLoading] = useState(false);
  const [exploreBestMove, setExploreBestMove] = useState(null); // Best move for current exploration position
  const [exploreBestLoading, setExploreBestLoading] = useState(false);

  // Load PGN
  useEffect(() => {
    if (!pgn) return;
    setAnalysis([]);
    setCurrentMove(0);
    setError(null);
    try {
      chess.loadPgn(pgn);
      setMoves(chess.history({ verbose: true }));
      setPosition('start');
    } catch (err) {
      setError(`Error loading PGN: ${err.message}`);
    }
  }, [pgn, chess]);

  // Fetch analysis
  const fetchAnalysis = useCallback(() => {
    if (!pgn) return;
    setLoading(true);
    if (onLoadingChange) onLoadingChange(true);
    setError(null);
    fetch('/api/analyze?t=' + Date.now(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
      body: JSON.stringify({ pgn_data: pgn.trim() })
    })
      .then(async r => {
        if (!r.ok) throw new Error(`Error: ${r.status}`);
        const text = await r.text();
        console.log('=== RAW RESPONSE TEXT (first 500 chars) ===');
        console.log(text.substring(0, 500));
        return JSON.parse(text);
      })
      .then(data => {
        // Debug: log raw response JSON and specific cp_loss values
        console.log('=== PARSED JSON DEBUG ===');
        console.log('Raw data.moves[0]:', data?.moves?.[0]);
        console.log('cp_loss in first move:', data?.moves?.[0]?.cp_loss);
        console.log('All keys in first move:', data?.moves?.[0] ? Object.keys(data.moves[0]) : 'N/A');

        if (data?.moves?.length) {
          const analysisData = data.moves.map((item, idx) => {
            return {
              move: moves[idx] || {},
              playedSan: moves[idx]?.san || item.move || '',
              bestMove: item.best_move || null,
              eval: item.eval ?? null,  // Keep as number for accuracy calc
              evalBefore: item.eval_before ?? null,  // For win probability calculation
              label: item.quality?.toLowerCase() || 'good',
              comment: item.comment || '',
              cpLoss: item.cp_loss ?? null
            };
          });
          const dataId = Date.now();
          console.log(`[${dataId}] First analysisData item cpLoss:`, analysisData[0]?.cpLoss);
          console.log(`[${dataId}] Calling setAnalysis and onAnalysisComplete with ${analysisData.length} moves`);
          setAnalysis(analysisData);
          if (onAnalysisComplete) onAnalysisComplete(analysisData);
        }
      })
      .catch(err => setError(err.message))
      .finally(() => {
        setLoading(false);
        if (onLoadingChange) onLoadingChange(false);
      });
  }, [pgn, moves, onAnalysisComplete, onLoadingChange]);

  useEffect(() => {
    if (pgn && moves.length > 0 && !analysis.length && !loading) fetchAnalysis();
  }, [pgn, moves.length, analysis.length, loading, fetchAnalysis]);

  // Update position
  useEffect(() => {
    if (currentMove === 0) {
      setPosition('start');
      return;
    }
    const game = new Chess();
    for (let i = 0; i < currentMove && i < moves.length; i++) {
      game.move(moves[i]);
    }
    setPosition(game.fen());
  }, [currentMove, moves]);

  // Navigation
  const goToMove = (n) => {
    setCurrentMove(Math.max(0, Math.min(n, moves.length)));
    setShowBestMove(false);
    exitExploreMode();
  };

  // Explore mode functions
  const enterExploreMode = () => {
    if (currentMove === 0) return;
    const tempChess = new Chess();
    for (let i = 0; i < currentMove - 1 && i < moves.length; i++) {
      tempChess.move(moves[i]);
    }
    setExploreChess(tempChess);
    setExploreMoves([]);
    setExploreHistory([tempChess.fen()]); // Store initial position
    setLastMoveEval(null);
    setExploreBestMove(null);
    setExploreMode(true);
    setShowBestMove(false);
  };

  const exitExploreMode = () => {
    setExploreMode(false);
    setExploreChess(null);
    setExploreMoves([]);
    setExploreHistory([]);
    setLastMoveEval(null);
    setExploreBestMove(null);
    setEvalLoading(false);
    setExploreBestLoading(false);
  };

  const evaluateMove = async (fen, moveSan, isWhiteTurn) => {
    setEvalLoading(true);
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pgn_data: `[FEN "${fen}"]\n\n1. ${moveSan}` })
      });
      if (response.ok) {
        const data = await response.json();
        if (data.moves?.[0]) {
          setLastMoveEval({
            move: moveSan,
            quality: data.moves[0].quality,
            comment: data.moves[0].comment,
            eval: data.moves[0].eval,
            bestMove: data.moves[0].best_move,
            isWhite: isWhiteTurn
          });
        }
      }
    } catch {
      setLastMoveEval({ move: moveSan, quality: 'unknown', comment: 'Could not evaluate' });
    } finally {
      setEvalLoading(false);
    }
  };

  const onPieceDrop = (from, to) => {
    if (!exploreMode || !exploreChess) return false;
    const newChess = new Chess(exploreChess.fen());
    const isWhiteTurn = newChess.turn() === 'w';
    try {
      const result = newChess.move({ from, to, promotion: 'q' });
      if (!result) return false;
      const fenBefore = exploreChess.fen();
      setExploreMoves(prev => [...prev, { san: result.san, isWhite: isWhiteTurn }]);
      setExploreHistory(prev => [...prev, newChess.fen()]); // Track FEN history
      setExploreChess(newChess);
      setExploreBestMove(null); // Clear best move when making a new move
      evaluateMove(fenBefore, result.san, isWhiteTurn);
      return true;
    } catch {
      return false;
    }
  };

  const undoExploreMove = () => {
    if (!exploreChess || exploreMoves.length === 0) return;
    const newChess = new Chess(exploreChess.fen());
    newChess.undo();
    setExploreChess(newChess);
    setExploreMoves(prev => prev.slice(0, -1));
    setExploreHistory(prev => prev.slice(0, -1));
    setLastMoveEval(null);
    setExploreBestMove(null);
  };

  // Go back to a specific exploration position
  const goToExplorePosition = (index) => {
    if (index < 0 || index >= exploreHistory.length) return;
    const newChess = new Chess(exploreHistory[index]);
    setExploreChess(newChess);
    setExploreMoves(prev => prev.slice(0, index));
    setExploreHistory(prev => prev.slice(0, index + 1));
    setLastMoveEval(null);
    setExploreBestMove(null);
  };

  // Get best move for current exploration position
  const getExploreBestMove = async () => {
    if (!exploreChess) return;
    setExploreBestLoading(true);
    setExploreBestMove(null);
    try {
      const fen = exploreChess.fen();
      // Create a minimal PGN with just the FEN to get best move
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pgn_data: `[FEN "${fen}"]\n[SetUp "1"]\n\n1. e4` }) // Dummy move to trigger analysis
      });
      if (response.ok) {
        const data = await response.json();
        if (data.moves?.[0]?.best_move) {
          // Parse the best move and show as arrow
          const tempChess = new Chess(fen);
          try {
            const move = tempChess.move(data.moves[0].best_move);
            if (move) {
              setExploreBestMove({ from: move.from, to: move.to, san: move.san });
            }
          } catch {
            setExploreBestMove({ san: data.moves[0].best_move });
          }
        }
      }
    } catch {
      // Ignore errors
    } finally {
      setExploreBestLoading(false);
    }
  };

  // Keyboard nav
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'ArrowLeft' && currentMove > 0) goToMove(currentMove - 1);
      else if (e.key === 'ArrowRight' && currentMove < moves.length) goToMove(currentMove + 1);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  });

  // Current move info
  const info = currentMove > 0 && analysis[currentMove - 1] ? (() => {
    const a = analysis[currentMove - 1];
    const moveNum = Math.floor((currentMove - 1) / 2) + 1;
    const isWhite = (currentMove - 1) % 2 === 0;
    return {
      quality: a.label,
      color: QUALITY_COLORS[a.label] || '#666',
      label: a.label.charAt(0).toUpperCase() + a.label.slice(1),
      moveText: `${moveNum}${isWhite ? '.' : '...'} ${moves[currentMove - 1]?.san}`,
      comment: a.comment,
      eval: a.eval,
      bestMove: a.bestMove
    };
  })() : null;

  // Best move arrow
  const getBestMoveArrow = () => {
    // Show explore best move arrow during exploration
    if (exploreMode && exploreBestMove?.from && exploreBestMove?.to) {
      return [[exploreBestMove.from, exploreBestMove.to, 'rgba(0, 180, 80, 0.8)']];
    }
    // Show regular best move arrow
    if (!showBestMove || !info?.bestMove) return [];
    const tempChess = new Chess();
    for (let i = 0; i < currentMove - 1 && i < moves.length; i++) {
      tempChess.move(moves[i]);
    }
    try {
      const m = tempChess.move(info.bestMove);
      if (m) return [[m.from, m.to, 'rgba(0, 180, 80, 0.8)']];
    } catch {}
    return [];
  };

  // Highlight squares (both source and destination)
  const getHighlight = () => {
    if (currentMove === 0 || !moves[currentMove - 1]) return {};
    const move = moves[currentMove - 1];
    const q = analysis[currentMove - 1]?.label;

    // Always highlight from/to squares with a subtle yellow for last move
    const fromSq = move.from;
    const toSq = move.to;

    // Base highlight color (Chess.com style yellow for last move)
    const lastMoveColor = 'rgba(255, 255, 0, 0.4)';

    // If we have quality info, use quality color for destination
    if (q && BOARD_HIGHLIGHT_QUALITIES.includes(q)) {
      const qualityColor = QUALITY_COLORS[q] + '80'; // 50% opacity
      return {
        [fromSq]: { backgroundColor: lastMoveColor },
        [toSq]: { backgroundColor: qualityColor }
      };
    }

    // Default: just highlight both squares with last move color
    return {
      [fromSq]: { backgroundColor: lastMoveColor },
      [toSq]: { backgroundColor: lastMoveColor }
    };
  };

  return (
    <div className="flex gap-4">
      {error && (
        <div className="absolute top-4 left-4 right-4 p-2 bg-red-900/80 text-red-200 rounded text-sm">
          {error}
        </div>
      )}

      {/* Board Section */}
      <div className="flex-shrink-0">
        <div ref={boardRef} style={{ width: 480, position: 'relative' }}>
          <Chessboard
            id="board"
            position={exploreMode && exploreChess ? exploreChess.fen() : position}
            boardWidth={480}
            arePiecesDraggable={exploreMode}
            onPieceDrop={onPieceDrop}
            animationDuration={150}
            customSquareStyles={exploreMode ? {} : getHighlight()}
            customArrows={getBestMoveArrow()}
            boardOrientation={playerColor === 'black' ? 'black' : 'white'}
            customDarkSquareStyle={{ backgroundColor: '#779556' }}
            customLightSquareStyle={{ backgroundColor: '#ebecd0' }}
          />
          {/* Move Quality Icon Overlay on Board */}
          {!exploreMode && currentMove > 0 && analysis[currentMove - 1] && (() => {
            const q = analysis[currentMove - 1]?.label;
            if (!q || !BOARD_HIGHLIGHT_QUALITIES.includes(q)) return null;
            const sq = moves[currentMove - 1]?.to;
            if (!sq) return null;

            // Calculate position based on square
            const file = sq.charCodeAt(0) - 'a'.charCodeAt(0); // 0-7 for a-h
            const rank = parseInt(sq[1]) - 1; // 0-7 for 1-8
            const squareSize = 480 / 8;

            // Adjust for board orientation
            const isFlipped = playerColor === 'black';
            const x = isFlipped ? (7 - file) * squareSize : file * squareSize;
            const y = isFlipped ? rank * squareSize : (7 - rank) * squareSize;

            return (
              <div
                style={{
                  position: 'absolute',
                  left: x + squareSize - 16,
                  top: y - 8,
                  zIndex: 10,
                  pointerEvents: 'none',
                }}
              >
                <QualityIcon quality={q} size={24} />
              </div>
            );
          })()}
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center gap-1 mt-2">
          <button onClick={() => goToMove(0)} className="px-3 py-1.5 bg-neutral-700 hover:bg-neutral-600 rounded text-white text-sm">⟨⟨</button>
          <button onClick={() => goToMove(currentMove - 1)} disabled={currentMove === 0} className="px-3 py-1.5 bg-neutral-700 hover:bg-neutral-600 rounded text-white text-sm disabled:opacity-40">⟨</button>
          <button onClick={() => goToMove(currentMove + 1)} disabled={currentMove >= moves.length} className="px-3 py-1.5 bg-neutral-700 hover:bg-neutral-600 rounded text-white text-sm disabled:opacity-40">⟩</button>
          <button onClick={() => goToMove(moves.length)} className="px-3 py-1.5 bg-neutral-700 hover:bg-neutral-600 rounded text-white text-sm">⟩⟩</button>
        </div>

        {/* Comment Panel - Chess.com style */}
        {info && !exploreMode && (
          <div className="mt-3 rounded-lg overflow-hidden shadow-lg" style={{ maxWidth: 480 }}>
            <div
              className="flex items-center gap-3 px-4 py-3"
              style={{ backgroundColor: info.color }}
            >
              <QualityIcon quality={info.label?.toLowerCase()} size={28} />
              <div className="flex-1">
                <span className="font-bold text-white text-lg capitalize">{info.label}</span>
                <span className="text-white/90 ml-2">{info.moveText}</span>
              </div>
              {info.eval && (
                <span className="text-white font-medium text-lg">
                  {info.eval > 0 ? '+' : ''}{info.eval}
                </span>
              )}
            </div>
            <div className="bg-neutral-800 px-4 py-3">
              {info.comment && (
                <p className="text-neutral-200 text-sm leading-relaxed">{info.comment}</p>
              )}
              {info.bestMove && (
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={enterExploreMode}
                    className="px-3 py-1.5 bg-neutral-700 hover:bg-neutral-600 rounded text-sm text-white font-medium transition-colors"
                  >
                    What If?
                  </button>
                  <button
                    onClick={() => setShowBestMove(!showBestMove)}
                    className={`px-3 py-1.5 rounded text-sm text-white font-medium transition-colors ${
                      showBestMove ? 'bg-green-600 hover:bg-green-500' : 'bg-neutral-700 hover:bg-neutral-600'
                    }`}
                  >
                    {showBestMove ? 'Hide Best' : 'Show Best'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Explore Mode */}
        {exploreMode && (
          <div className="mt-3 bg-purple-900/50 border border-purple-700 rounded p-3" style={{ maxWidth: 480 }}>
            <div className="flex items-center justify-between">
              <span className="text-purple-300 font-medium text-sm">Exploring</span>
              <div className="flex gap-1">
                <button
                  onClick={() => goToExplorePosition(0)}
                  disabled={exploreMoves.length === 0}
                  className="px-2 py-1 bg-neutral-700 hover:bg-neutral-600 rounded text-xs text-white disabled:opacity-40"
                  title="Go to start"
                >⟨⟨</button>
                <button
                  onClick={undoExploreMove}
                  disabled={exploreMoves.length === 0}
                  className="px-2 py-1 bg-neutral-700 hover:bg-neutral-600 rounded text-xs text-white disabled:opacity-40"
                  title="Undo last move"
                >⟨</button>
                <button onClick={exitExploreMode} className="px-2 py-1 bg-red-800 hover:bg-red-700 rounded text-xs text-white">Exit</button>
              </div>
            </div>

            {/* Move history - clickable */}
            {exploreMoves.length > 0 && (
              <div className="text-purple-200 text-sm mt-2 flex flex-wrap gap-1">
                <button
                  onClick={() => goToExplorePosition(0)}
                  className="text-purple-400 hover:text-purple-200 underline"
                >Start</button>
                {exploreMoves.map((m, i) => (
                  <button
                    key={i}
                    onClick={() => goToExplorePosition(i + 1)}
                    className={`hover:text-white ${i === exploreMoves.length - 1 ? 'text-white font-medium' : 'text-purple-300'}`}
                  >
                    {m.isWhite && `${Math.floor(i/2)+1}.`}{m.san}
                  </button>
                ))}
              </div>
            )}

            {/* Get Best Move button */}
            <div className="mt-2 flex gap-2">
              <button
                onClick={getExploreBestMove}
                disabled={exploreBestLoading}
                className={`px-2 py-1 rounded text-xs text-white ${exploreBestMove ? 'bg-green-700' : 'bg-neutral-700 hover:bg-neutral-600'} disabled:opacity-50`}
              >
                {exploreBestLoading ? 'Loading...' : exploreBestMove ? `Best: ${exploreBestMove.san}` : 'Get Best Move'}
              </button>
              {exploreBestMove && (
                <button
                  onClick={() => setExploreBestMove(null)}
                  className="px-2 py-1 bg-neutral-700 hover:bg-neutral-600 rounded text-xs text-white"
                >Hide</button>
              )}
            </div>

            {evalLoading && <div className="text-purple-300 text-xs mt-2">Analyzing your move...</div>}
            {lastMoveEval && !evalLoading && (
              <div className="mt-2 text-sm">
                <span className="font-medium" style={{ color: QUALITY_COLORS[lastMoveEval.quality] || '#999' }}>{lastMoveEval.quality}</span>
                {lastMoveEval.comment && <span className="text-neutral-400 ml-2">{lastMoveEval.comment}</span>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Move List */}
      <div className="flex-1 min-w-0">

        <div ref={moveListRef} className="bg-neutral-800 rounded overflow-hidden" style={{ maxHeight: 540 }}>
          <div className="overflow-y-auto p-2" style={{ maxHeight: 540 }}>
            {Array.from({ length: Math.ceil(moves.length / 2) }).map((_, i) => {
              const wIdx = i * 2;
              const bIdx = i * 2 + 1;
              const wMove = moves[wIdx];
              const bMove = moves[bIdx];
              const wQ = analysis[wIdx]?.label;
              const bQ = analysis[bIdx]?.label;
              const wHighlight = HIGHLIGHT_QUALITIES.includes(wQ);
              const bHighlight = HIGHLIGHT_QUALITIES.includes(bQ);
              const wActive = currentMove === wIdx + 1;
              const bActive = currentMove === bIdx + 1;

              return (
                <div key={i} className="flex items-center text-sm py-0.5">
                  <span className="w-7 text-neutral-500 text-right pr-2 flex-shrink-0">{i + 1}.</span>
                  <button
                    onClick={() => goToMove(wIdx + 1)}
                    className={`flex-1 text-left px-2 py-0.5 rounded mr-1 transition-colors ${wActive ? 'bg-neutral-600' : 'hover:bg-neutral-700'}`}
                    style={wHighlight ? { color: QUALITY_COLORS[wQ] } : { color: '#e5e5e5' }}
                  >
                    {wMove?.san}
                    {wHighlight && <span className="ml-1 text-xs">{'?!?'.charAt(['inaccuracy','mistake','blunder'].indexOf(wQ)) || '!!'}</span>}
                  </button>
                  {bMove ? (
                    <button
                      onClick={() => goToMove(bIdx + 1)}
                      className={`flex-1 text-left px-2 py-0.5 rounded transition-colors ${bActive ? 'bg-neutral-600' : 'hover:bg-neutral-700'}`}
                      style={bHighlight ? { color: QUALITY_COLORS[bQ] } : { color: '#e5e5e5' }}
                    >
                      {bMove.san}
                      {bHighlight && <span className="ml-1 text-xs">{'?!?'.charAt(['inaccuracy','mistake','blunder'].indexOf(bQ)) || '!!'}</span>}
                    </button>
                  ) : <div className="flex-1" />}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BoardAnalysis;
