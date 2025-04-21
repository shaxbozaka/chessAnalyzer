// Stockfish.js Web Worker wrapper
// This file loads the Stockfish WASM engine and handles communication

// You would normally use the npm package or download stockfish.wasm
// For this demo, we'll simulate Stockfish responses

let isReady = false;
let currentFen = '';
let analyzing = false;

self.onmessage = function(e) {
  const cmd = e.data;
  
  if (cmd === 'uci') {
    // Simulate engine initialization
    setTimeout(() => {
      postMessage('uciok');
      isReady = true;
    }, 100);
    return;
  }
  
  if (cmd.startsWith('position fen')) {
    currentFen = cmd.substring('position fen '.length);
    return;
  }
  
  if (cmd.startsWith('go')) {
    if (!isReady) return;
    analyzing = true;
    
    // Simulate analysis
    setTimeout(() => {
      // Send info with score
      const randomScore = Math.floor(Math.random() * 100) - 50;
      postMessage(`info depth 15 seldepth 20 multipv 1 score cp ${randomScore} nodes 1000000 nps 100000 time 1000 pv e2e4 e7e5 g1f3`);
      
      // Small chance of mate score
      if (Math.random() < 0.1) {
        const mateIn = Math.floor(Math.random() * 5) + 1;
        postMessage(`info depth 15 seldepth 20 multipv 1 score mate ${mateIn} nodes 1000000 nps 100000 time 1000 pv d8h4 g2g3 h4e4`);
      }
      
      // Generate a random best move
      const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
      const ranks = ['1', '2', '3', '4', '5', '6', '7', '8'];
      const from = files[Math.floor(Math.random() * 8)] + ranks[Math.floor(Math.random() * 8)];
      const to = files[Math.floor(Math.random() * 8)] + ranks[Math.floor(Math.random() * 8)];
      const bestMove = from + to;
      
      postMessage(`bestmove ${bestMove} ponder e7e5`);
      analyzing = false;
    }, 500);
  }
};

// Simulate engine loaded
setTimeout(() => {
  isReady = true;
}, 100);
