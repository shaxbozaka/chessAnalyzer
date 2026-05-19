export default async function getGameReview({ pgn, username }) {
  const response = await fetch('/api/review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pgn, username })
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
