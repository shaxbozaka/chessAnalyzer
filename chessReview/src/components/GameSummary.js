import React from 'react';

// Performance rating icon component
const PerformanceIcon = ({ rating }) => {
  // rating: 'excellent' (checkmark), 'good' (thumbs up), 'ok' (dash), 'poor' (thumbs down)
  const icons = {
    excellent: (
      <svg viewBox="0 0 24 24" width={20} height={20} fill="#81b64c">
        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
      </svg>
    ),
    good: (
      <svg viewBox="0 0 24 24" width={20} height={20} fill="#96bc4b">
        <path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/>
      </svg>
    ),
    ok: (
      <div style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 12, height: 3, backgroundColor: '#888', borderRadius: 2 }} />
      </div>
    ),
    poor: (
      <svg viewBox="0 0 24 24" width={20} height={20} fill="#fa412d">
        <path d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z"/>
      </svg>
    )
  };
  return icons[rating] || icons.ok;
};

// Calculate game rating number (like Chess.com's 1200, 950 numbers)
// Based on accuracy percentage mapped to a rating-like scale
const calculateGameRating = (accuracy) => {
  if (accuracy === null || accuracy === undefined) return null;
  const acc = parseFloat(accuracy);

  // Map accuracy to a rating-like number
  // 100% accuracy = ~1500 rating points in this scale
  // 50% accuracy = ~500 rating points
  // Formula: rating = accuracy * 15 (so 80% = 1200, 60% = 900, etc.)
  return Math.round(acc * 15);
};

// Calculate phase performance based on moves in that phase
const calculatePhasePerformance = (analysis, isWhite, startPly, endPly) => {
  const phaseMoves = [];
  let bookMoves = 0;
  let totalPlayerMoves = 0;

  for (let i = startPly; i < Math.min(endPly, analysis.length); i++) {
    // Check if this move belongs to the player
    const isWhiteMove = i % 2 === 0;
    if (isWhiteMove === isWhite) {
      const move = analysis[i];
      if (move) {
        totalPlayerMoves++;
        // Check both label and quality fields (backend uses 'quality')
        const quality = move.label?.toLowerCase() || move.quality?.toLowerCase() || 'good';
        if (quality === 'book') {
          bookMoves++;
        } else {
          phaseMoves.push(quality);
        }
      }
    }
  }

  // If no moves in this phase for this player, return null
  if (totalPlayerMoves === 0) return null;

  // If all moves were book moves, return excellent (theory = good)
  if (phaseMoves.length === 0 && bookMoves > 0) return 'excellent';

  // If still no moves to evaluate, return null
  if (phaseMoves.length === 0) return null;

  // Count bad moves - include 'miss' as a negative
  const blunders = phaseMoves.filter(q => q === 'blunder').length;
  const mistakes = phaseMoves.filter(q => q === 'mistake').length;
  const misses = phaseMoves.filter(q => q === 'miss').length;
  const inaccuracies = phaseMoves.filter(q => q === 'inaccuracy').length;

  // Calculate total "bad" moves weighted by severity
  // Blunder = 3 points, Mistake = 2, Miss = 1.5, Inaccuracy = 1
  const badScore = blunders * 3 + mistakes * 2 + misses * 1.5 + inaccuracies * 1;
  const totalMoves = phaseMoves.length;

  // Calculate average "badness" per move
  const avgBadness = badScore / totalMoves;

  // Determine overall performance based on average badness
  if (avgBadness >= 1.5) return 'poor';      // Many blunders/mistakes
  if (avgBadness >= 0.8) return 'ok';        // Some mistakes
  if (avgBadness >= 0.3) return 'good';      // Minor issues
  return 'excellent';                         // Clean play
};

const GameSummary = ({ analysis, pgn, username, whiteAccuracy, blackAccuracy, white, black }) => {
  if (!analysis || analysis.length === 0) return null;

  // Define game phases (approximate move numbers)
  // Opening: first 10 moves (20 plies)
  // Middlegame: moves 11-30 (plies 20-60)
  // Endgame: moves 31+ (plies 60+)
  const openingEnd = 20;
  const middlegameEnd = 60;

  // Calculate performance for each phase for both players
  const whiteOpening = calculatePhasePerformance(analysis, true, 0, openingEnd);
  const whiteMiddlegame = calculatePhasePerformance(analysis, true, openingEnd, middlegameEnd);
  const whiteEndgame = calculatePhasePerformance(analysis, true, middlegameEnd, analysis.length);

  const blackOpening = calculatePhasePerformance(analysis, false, 0, openingEnd);
  const blackMiddlegame = calculatePhasePerformance(analysis, false, openingEnd, middlegameEnd);
  const blackEndgame = calculatePhasePerformance(analysis, false, middlegameEnd, analysis.length);

  // Calculate game ratings
  const whiteRating = calculateGameRating(whiteAccuracy);
  const blackRating = calculateGameRating(blackAccuracy);

  return (
    <div className="bg-neutral-800 rounded-lg overflow-hidden" style={{ minWidth: 280 }}>
      {/* Header */}
      <div className="bg-neutral-700 px-4 py-2">
        <h3 className="text-white font-semibold text-sm">Game Summary</h3>
      </div>

      {/* Summary Table */}
      <div className="p-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-neutral-400">
              <th className="text-left font-normal pb-2"></th>
              <th className="text-center font-normal pb-2 w-20">
                <div className="flex items-center justify-center gap-1">
                  <div className="w-3 h-3 bg-white rounded-sm" />
                  <span className="text-xs truncate max-w-[60px]">{white || 'White'}</span>
                </div>
              </th>
              <th className="text-center font-normal pb-2 w-20">
                <div className="flex items-center justify-center gap-1">
                  <div className="w-3 h-3 bg-neutral-900 rounded-sm border border-neutral-600" />
                  <span className="text-xs truncate max-w-[60px]">{black || 'Black'}</span>
                </div>
              </th>
            </tr>
          </thead>
          <tbody className="text-neutral-200">
            {/* Game Rating Row */}
            <tr className="border-t border-neutral-700">
              <td className="py-2 text-neutral-400">Game Rating</td>
              <td className="py-2 text-center">
                <span className="font-bold text-lg text-green-400">{whiteRating || '-'}</span>
              </td>
              <td className="py-2 text-center">
                <span className="font-bold text-lg text-green-400">{blackRating || '-'}</span>
              </td>
            </tr>

            {/* Accuracy Row */}
            <tr className="border-t border-neutral-700">
              <td className="py-2 text-neutral-400">Accuracy</td>
              <td className="py-2 text-center">
                <span className="font-medium text-green-400">{whiteAccuracy || '-'}%</span>
              </td>
              <td className="py-2 text-center">
                <span className="font-medium text-green-400">{blackAccuracy || '-'}%</span>
              </td>
            </tr>

            {/* Opening Row */}
            <tr className="border-t border-neutral-700">
              <td className="py-2 text-neutral-400">Opening</td>
              <td className="py-2 text-center">
                {whiteOpening && <PerformanceIcon rating={whiteOpening} />}
              </td>
              <td className="py-2 text-center">
                {blackOpening && <PerformanceIcon rating={blackOpening} />}
              </td>
            </tr>

            {/* Middlegame Row */}
            <tr className="border-t border-neutral-700">
              <td className="py-2 text-neutral-400">Middlegame</td>
              <td className="py-2 text-center">
                {whiteMiddlegame && <PerformanceIcon rating={whiteMiddlegame} />}
              </td>
              <td className="py-2 text-center">
                {blackMiddlegame && <PerformanceIcon rating={blackMiddlegame} />}
              </td>
            </tr>

            {/* Endgame Row */}
            {(whiteEndgame || blackEndgame) && (
              <tr className="border-t border-neutral-700">
                <td className="py-2 text-neutral-400">Endgame</td>
                <td className="py-2 text-center">
                  {whiteEndgame && <PerformanceIcon rating={whiteEndgame} />}
                </td>
                <td className="py-2 text-center">
                  {blackEndgame && <PerformanceIcon rating={blackEndgame} />}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Move Quality Stats */}
        <div className="mt-4 pt-3 border-t border-neutral-700">
          <div className="grid grid-cols-2 gap-4 text-xs">
            {/* White Stats */}
            <div>
              <div className="text-neutral-400 mb-2">White Moves</div>
              <MoveQualityStats analysis={analysis} isWhite={true} />
            </div>

            {/* Black Stats */}
            <div>
              <div className="text-neutral-400 mb-2">Black Moves</div>
              <MoveQualityStats analysis={analysis} isWhite={false} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Move quality statistics component
// Chess.com combines "excellent" into "best" category, so we do the same
const MoveQualityStats = ({ analysis, isWhite }) => {
  // Track all qualities separately first
  const rawStats = { brilliant: 0, excellent: 0, best: 0, good: 0, inaccuracy: 0, mistake: 0, miss: 0, blunder: 0 };

  analysis.forEach((move, idx) => {
    const isWhiteMove = idx % 2 === 0;
    if (isWhiteMove === isWhite) {
      const quality = move.label?.toLowerCase() || move.quality?.toLowerCase() || 'good';
      if (rawStats.hasOwnProperty(quality)) {
        rawStats[quality]++;
      }
    }
  });

  // Combine excellent into best (Chess.com style)
  const stats = {
    brilliant: rawStats.brilliant,
    best: rawStats.best + rawStats.excellent,  // Combine best + excellent
    good: rawStats.good,
    inaccuracy: rawStats.inaccuracy,
    mistake: rawStats.mistake,
    miss: rawStats.miss,
    blunder: rawStats.blunder
  };

  const colors = {
    brilliant: '#1baca6',
    best: '#96bc4b',
    good: '#81b64c',
    inaccuracy: '#f7c631',
    mistake: '#ffa459',
    miss: '#e86b5a',
    blunder: '#fa412d'
  };

  return (
    <div className="space-y-1">
      {Object.entries(stats).map(([quality, count]) => (
        count > 0 && (
          <div key={quality} className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: colors[quality] }}
              />
              <span className="capitalize text-neutral-300">{quality}</span>
            </div>
            <span className="text-neutral-400">{count}</span>
          </div>
        )
      ))}
    </div>
  );
};

export default GameSummary;
