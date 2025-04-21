import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import ChessGames from './components/ChessGames';
import AnalysisPage from './pages/AnalysisPage';
import { ThemeProvider } from './utils/ThemeContext';

function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={
            <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 transition-colors duration-200">
              <div className="max-w-4xl mx-auto px-4">
                <header className="mb-8 text-center">
                  <h1 className="text-3xl font-bold text-gray-800 dark:text-gray-100">Chess.com Game Review</h1>
                  <p className="text-gray-600 dark:text-gray-400 mt-2">Analyze your recent games from Chess.com</p>
                </header>
                
                <ChessGames />
              </div>
            </div>
          } />
          <Route path="/analysis/:year/:month/:gameId" element={<AnalysisPage />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
