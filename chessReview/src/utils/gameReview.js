export default async function getGameReview({ pgn, username, analysis }) {
  const analysisPayload = Array.isArray(analysis)
    ? analysis.map((item, index) => ({
        ply: index + 1,
        move: item.playedSan || item.move?.san || item.move || '',
        quality: item.quality || item.label,
        comment: item.comment,
        eval: item.eval,
        eval_before: item.evalBefore,
        best_move: item.bestMove,
        cp_loss: item.cpLoss,
        expected_loss: item.expectedLoss,
        top_moves: item.topMoves
      }))
    : undefined;

  const response = await fetch('/api/review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pgn, username, analysis: analysisPayload })
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    // Keep the thrown error below focused on the HTTP status.
  }

  if (!response.ok) {
    throw new Error(data?.detail || `Review request failed: ${response.status}`);
  }

  return data.summary;
}
