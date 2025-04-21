# AI Chess Coach

A modern React + Tailwind CSS web application that lets users enter their Chess.com username, pick a game, and get move‑by‑move coaching powered by Stockfish and GPT‑4.

---

## Features

- **Home / Username Input**: Enter Chess.com username, fetch and display last 10 games as responsive cards (opponent, date, result badge, opening name)
- **Game Selection**: Click a card to analyze a game (`/analysis/{year}/{month}/{gameId}`)
- **Analysis Page**: Interactive board, move list, Stockfish eval, move quality labels, GPT-4 coaching tips
- **Step-by-Step AI Review**: Automatic game walkthrough with animated pieces and real-time coaching
- **Summary & Export**: Accuracy %, count of inaccuracies/mistakes/blunders, top suggestions, PDF report
- **UX**: Responsive, clean, soft UI, spinners, user-friendly errors

## Tech Stack
- **Frontend**: React, Tailwind CSS, chess.js, react-chessboard, react-router-dom, jspdf
- **Backend**: Express, OpenAI API
- **Chess Engine**: Stockfish (Web Worker)

## Setup Instructions

### Frontend Setup

1. **Clone & Install**
   ```sh
   git clone <your-repo-url>
   cd ai-chess-coach
   npm install
   ```

2. **Tailwind CSS**
   Already configured via `postcss.config.js` and `tailwind.config.js`.

3. **Run Development Server**
   ```sh
   npm start
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

### Backend Setup

1. **Install Backend Dependencies**
   ```sh
   cd backend
   npm install
   ```

2. **Configure Environment Variables**
   - Create or edit the `.env` file in the backend directory:
     ```env
     OPENAI_API_KEY=your_openai_api_key_here
     PORT=5000
     ```
   - Replace `your_openai_api_key_here` with your actual OpenAI API key

3. **Start the Backend Server**
   ```sh
   npm start
   ```
   The server will run on [http://localhost:5000](http://localhost:5000)

## Building for Production

```sh
# Build frontend
cd ai-chess-coach
npm run build

# For backend deployment
cd backend
npm install --production
```

## Project Structure

```
/
├── public/                # Static assets
│   └── stockfish.js       # Stockfish web worker
├── src/
│   ├── components/        # React components
│   │   ├── ChessGames.js  # Game list component
│   │   ├── BoardAnalysis.js # Chess board & analysis
│   │   └── GameSummary.js # Summary & PDF export
│   ├── pages/             # Page components
│   │   ├── Home.js        # Home page
│   │   └── AnalysisPage.js # Analysis page
│   └── utils/             # Utility functions
│       ├── chessApi.js    # Chess.com API functions
│       ├── gptCoach.js    # OpenAI integration
│       └── stockfishWASM.js # Stockfish integration
└── backend/              # Express server
    ├── server.js         # Backend API
    └── .env              # Environment variables
```

## How It Works

1. **Game Analysis**:
   - Stockfish evaluates each position and suggests the best move
   - Positions are compared to determine move quality (Excellent to Blunder)

2. **AI Coaching**:
   - The backend sends position data to OpenAI's GPT-4
   - GPT-4 provides coaching tips based on the position, move played, and engine suggestion

3. **Step-by-Step Review**:
   - Click "Start AI Review" to automatically play through the game
   - Each move is displayed with animation and coaching tips

## Notes
- The backend requires a valid OpenAI API key
- For development without an API key, the app will fall back to pre-defined coaching tips
- Stockfish analysis is performed client-side using Web Workers

---

MIT License
