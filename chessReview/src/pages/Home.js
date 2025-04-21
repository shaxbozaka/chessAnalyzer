import React from 'react';
import ChessGames from '../components/ChessGames';

const Home = () => {
  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <header className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-gray-800">AI Chess Coach</h1>
          <p className="text-gray-600 mt-2">Get move‑by‑move coaching powered by Stockfish &amp; GPT‑4</p>
        </header>
        <ChessGames />
      </div>
    </div>
  );
};

export default Home;
