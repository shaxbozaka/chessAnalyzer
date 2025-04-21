import axios from 'axios';

export const getArchives = async (username) => {
  const { data } = await axios.get(`https://api.chess.com/pub/player/${username}/games/archives`);
  return data.archives; // array of URLs
};

export const getMonthlyGames = async (username, year, month) => {
  const url = `https://api.chess.com/pub/player/${username}/games/${year}/${month}`;
  const { data } = await axios.get(url);
  return data.games; // array of games with PGN
};
