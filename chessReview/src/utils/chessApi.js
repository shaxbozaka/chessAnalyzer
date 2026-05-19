export const getArchives = async (username) => {
  const response = await fetch(`https://api.chess.com/pub/player/${username}/games/archives`);
  if (!response.ok) {
    throw new Error(`Failed to fetch archives: ${response.status}`);
  }
  const data = await response.json();
  return data.archives; // array of URLs
};

export const getMonthlyGames = async (username, year, month) => {
  const url = `https://api.chess.com/pub/player/${username}/games/${year}/${month}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch games: ${response.status}`);
  }
  const data = await response.json();
  return data.games; // array of games with PGN
};
