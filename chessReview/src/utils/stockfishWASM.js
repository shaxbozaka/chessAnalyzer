import { Chess } from "chess.js";

class StockfishWrapper {
  constructor() {
    this.worker = null;
    this.isReady = false;
    this.queue = []; // to support multiple analyze() calls
    this.activeJob = null;
  }

  init() {
    if (this.worker) return Promise.resolve();

    return new Promise((resolve, reject) => {
      try {
        const workerPath = `${process.env.PUBLIC_URL || ''}/stockfish.js`;
        this.worker = new Worker(workerPath);
      } catch (e) {
        console.error("Failed to create Stockfish worker", e);
        return reject(e);
      }

      this.worker.onerror = (err) => {
        console.error("Stockfish worker error", err.message || err);
      };

      this.worker.onmessage = (e) => {
        const msg = e.data;

        if (msg === "uciok") {
          this.isReady = true;
          this.sendCommand("setoption name Threads value 4");
          this.sendCommand("setoption name Hash value 64");
          resolve();
        }

        const job = this.activeJob;
        if (!job) return;

        if (msg.includes("score cp")) {
          const m = msg.match(/score cp ([-\d]+)/);
          if (m) job.eval = parseInt(m[1], 10) / 100;
        }

        if (msg.includes("score mate")) {
          const m = msg.match(/score mate ([-\d]+)/);
          if (m) {
            const mate = parseInt(m[1], 10);
            job.eval = mate > 0 ? 999 : -999;
            job.mate = mate;
          }
        }

        if (msg.startsWith("bestmove")) {
          const parts = msg.split(" ");
          job.bestMove = parts[1];
          this.finishJob();
        }
      };

      this.sendCommand("uci");
    });
  }

  sendCommand(cmd) {
    if (!this.worker) return;
    this.worker.postMessage(cmd);
  }

  finishJob() {
    const job = this.activeJob;
    if (!job) return;

    try {
      const { fen, playedMove, resolve, eval: bestEval, mate, bestMove } = job;
      const chess = new Chess(fen);

      // Get playedUci and convert to SAN format safely
      let playedUci = '';
      let playedSan = '?';
      
      if (playedMove) {
        if (typeof playedMove === 'string') {
          // If it's already SAN format
          playedSan = playedMove;
        } else {
          // Get UCI from move object
          playedUci = playedMove.from + playedMove.to + (playedMove.promotion || "");
          playedSan = this.uciToSan(chess, playedUci);
        }
      }
      
      // Convert bestMove to SAN safely
      const bestSan = bestMove ? this.uciToSan(chess, bestMove) : '?';

      // Determine move quality label
      let label = "ordinary";
      if (bestMove && playedUci === bestMove) {
        label = "excellent";
      } else if (typeof bestEval === 'number' && typeof job.evalPlayed === 'number') {
        const diff = Math.abs(bestEval - job.evalPlayed);
        if (diff > 2) label = "blunder";
        else if (diff > 1) label = "mistake";
        else if (diff > 0.5) label = "inaccuracy";
      }

      // Return result
      resolve({
        playedSan,
        bestSan,
        eval: this.formatEval(bestEval, mate),
        label,
      });
    } catch (e) {
      console.error('Error in finishJob:', e);
      // Return a safe result
      job.resolve({
        playedSan: job.playedMove?.san || '?',
        bestSan: '?',
        eval: '0.0',
        label: 'ordinary',
      });
    } finally {
      this.activeJob = null;
      this.processQueue();
    }
  }

  processQueue() {
    if (this.activeJob || this.queue.length === 0) return;

    this.activeJob = this.queue.shift();
    const { fen, depth } = this.activeJob;
    this.sendCommand("position fen " + fen);
    this.sendCommand("go depth " + depth);
  }

  uciToSan(chess, uci) {
    if (!uci || uci.length < 4) return uci || '?';
    
    try {
      const move = chess.move(
        {
          from: uci.slice(0, 2),
          to: uci.slice(2, 4),
          promotion: uci.length === 5 ? uci[4] : undefined,
        },
        { sloppy: true }
      );
      return move?.san || uci;
    } catch (e) {
      console.error('Error converting UCI to SAN:', e.message, uci);
      return uci; // Return original UCI notation if conversion fails
    }
  }

  formatEval(score, mate) {
    if (mate != null) {
      return mate > 0 ? `M${mate}` : `-M${Math.abs(mate)}`;
    }
    return score > 0 ? `+${score.toFixed(2)}` : score.toFixed(2);
  }

  async analyze(fen, playedMove, depth = 1) {
    await this.init();

    // Skip evalPlayed computation completely for speed
    const evalPlayed = 0;

    return new Promise((resolve) => {
      this.queue.push({
        fen,
        playedMove,
        depth,
        evalPlayed,
        resolve,
      });
      this.processQueue();
    });
  }

  evaluateFen(fen, depth = 4) {
    return new Promise((resolve) => {
      const handler = (e) => {
        const msg = e.data;
        if (msg.includes("score cp")) {
          const m = msg.match(/score cp ([-\d]+)/);
          if (m) {
            this.worker.removeEventListener("message", handler);
            resolve(parseInt(m[1], 10) / 100);
          }
        } else if (msg.includes("score mate")) {
          const m = msg.match(/score mate ([-\d]+)/);
          if (m) {
            this.worker.removeEventListener("message", handler);
            const mate = parseInt(m[1], 10);
            resolve(mate > 0 ? 999 : -999);
          }
        }
      };

      this.worker.addEventListener("message", handler);
      this.sendCommand("position fen " + fen);
      this.sendCommand("go depth " + depth);

      // Safety timeout 2 seconds
      setTimeout(() => {
        this.worker.removeEventListener("message", handler);
        resolve(0);
      }, 2000);
    });
  }

  destroy() {
    this.worker?.terminate();
    this.worker = null;
  }
}

export default new StockfishWrapper();
