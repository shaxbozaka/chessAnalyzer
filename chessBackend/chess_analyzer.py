import chess
import chess.engine
import chess.pgn
import chess.polyglot  # Added for opening book support
from io import StringIO
import os
import concurrent.futures
import functools

# Function to check if a move is in the opening book
def is_book_move(board, book_path, cache=None):
    # Use a dictionary cache to avoid repeated lookups
    if cache is None:
        cache = {}
    
    # Create a cache key using the board's FEN representation
    board_fen = board.fen()
    if board_fen in cache:
        return cache[board_fen]
    
    try:
        with chess.polyglot.open_reader(book_path) as reader:
            # Look for the position in the opening book
            entry = reader.get(board)
            result = entry is not None
            cache[board_fen] = result
            return result
    except Exception as e:
        print(f"Error checking book move: {e}")
        cache[board_fen] = False
        return False


def determine_move_quality(abs_delta, delta, side_to_move, is_book, forced, is_sacrifice, played_eval, best_eval, alt_evals=None):
    """Chess.com-style brilliant move detection."""
    if is_book:
        return "book"
    elif forced:
        return "forced"

    # Default quality classification
    if abs_delta <= 20:
        quality = "best"
    elif abs_delta <= 50:
        quality = "good"
    elif abs_delta <= 100:
        quality = "inaccuracy"
    elif abs_delta <= 300:
        quality = "mistake"
    else:
        quality = "blunder"

    # Chess.com-style brilliant move logic
    # - Must be a sacrifice
    # - Must be the only move that avoids a huge eval drop (all other moves lose >= 1.5 pawns compared to this move)
    # - Must not be the top engine move (but is the only move that keeps eval high)
    if is_sacrifice and alt_evals is not None and played_eval is not None:
        # Find the second-best move's eval (excluding the played move)
        alt_diffs = [abs(played_eval - e) for e in alt_evals if e is not None]
        if alt_diffs:
            min_alt_diff = min(alt_diffs)
            # If all other moves are at least 1.5 pawns worse
            if min_alt_diff >= 150 and played_eval >= 150:
                quality = "brilliant"
    return quality


# Worker function for parallel evaluation
def evaluate_position(position_data):
    """Evaluate a single position using Stockfish"""
    position, stockfish_path, depth = position_data
    
    # Create a new engine instance for this process
    engine = chess.engine.SimpleEngine.popen_uci(stockfish_path)
    
    # Configure engine for better performance
    engine.configure({
        "Threads": 1,              # Use single thread per process
        "Hash": 64,               # Hash size per engine instance
        "UCI_Elo": 1800,          # Set ELO to limit strength and improve speed
        "Skill Level": 10         # Balance between speed and accuracy
    })
    
    # Evaluate the position
    try:
        info = engine.analyse(position, chess.engine.Limit(depth=depth))
        eval_score = info["score"].white().score(mate_score=10000)
    except Exception as e:
        print(f"Error evaluating position: {e}")
        eval_score = None
    finally:
        engine.quit()
    
    return position.fen(), eval_score


def count_material(board):
    material = {'white': 0, 'black': 0}
    # Standard piece values: pawn=1, knight=3, bishop=3, rook=5, queen=9
    piece_values = {
        chess.PAWN: 1,
        chess.KNIGHT: 3,
        chess.BISHOP: 3,
        chess.ROOK: 5,
        chess.QUEEN: 9,
        chess.KING: 0  # King has no material value in this context
    }
    
    for square in chess.SQUARES:
        piece = board.piece_at(square)
        if piece is not None:
            value = piece_values[piece.piece_type]
            if piece.color == chess.WHITE:
                material['white'] += value
            else:
                material['black'] += value
    return material


def analyze_game(pgn_data, stockfish_path=None, book_path=None):
    # Use environment variables if parameters are not provided
    if stockfish_path is None:
        stockfish_path = os.environ.get('STOCKFISH_PATH', '/usr/games/stockfish')
    if book_path is None:
        book_path = os.environ.get('BOOK_PATH', '/app/bookfish.bin')
    
    game = chess.pgn.read_game(StringIO(pgn_data))
    board = game.board()
    
    # Process all moves at once to prepare the analysis
    moves = list(game.mainline_moves())
    positions = []
    
    # Setup the initial board
    curr_board = board.copy()
    positions.append(curr_board.copy())
    
    # Generate all positions after each move
    for move in moves:
        curr_board.push(move)
        positions.append(curr_board.copy())
    
    # Use a lower depth for faster analysis but still accurate results
    analysis_depth = 12
    
    # Prepare data for parallel processing
    position_data = [(pos, stockfish_path, analysis_depth) for pos in positions]
    
    # Create evaluation cache
    eval_cache = {}
    
    # Determine optimal number of workers based on CPU cores
    max_workers = min(os.cpu_count(), len(positions))
    
    # Process positions in parallel using ProcessPoolExecutor
    with concurrent.futures.ProcessPoolExecutor(max_workers=max_workers) as executor:
        # Submit all position evaluations in parallel
        futures = [executor.submit(evaluate_position, data) for data in position_data]
        
        # Collect results as they complete
        for future in concurrent.futures.as_completed(futures):
            try:
                fen, score = future.result()
                eval_cache[fen] = score
            except Exception as e:
                print(f"An error occurred during parallel processing: {e}")
    
    # Now analyze each move using the cached evaluations
    analysis = []
    book_cache = {}
    curr_board = board.copy()
    
    for i, move in enumerate(moves):
        san = curr_board.san(move)
        side_to_move = curr_board.turn
        pos_before_fen = curr_board.fen()
        is_book = False
        if i < 10:
            is_book = is_book_move(curr_board, book_path, book_cache)
        in_check = curr_board.is_check()
        legal = list(curr_board.legal_moves)
        forced = in_check and len(legal) == 1 and legal[0] == move
        eval_before = eval_cache.get(pos_before_fen)
        # Evaluate all legal moves for Chess.com-style brilliant detection
        alt_evals = []
        for alt_move in legal:
            if alt_move == move:
                continue
            alt_board = curr_board.copy()
            alt_board.push(alt_move)
            alt_eval = eval_cache.get(alt_board.fen())
            alt_evals.append(alt_eval)
        curr_board.push(move)
        pos_after_fen = curr_board.fen()
        eval_after = eval_cache.get(pos_after_fen)
        delta = 0
        abs_delta = 0
        if eval_before is not None and eval_after is not None:
            delta = eval_after - eval_before
            abs_delta = abs(delta)
        is_sacrifice = False
        board_before = chess.Board(pos_before_fen)
        board_after = chess.Board(pos_after_fen)
        if board_after is not None and board_before is not None:
            material_before = count_material(board_before)
            material_after = count_material(board_after)
            if side_to_move == chess.WHITE:
                if material_after['white'] < material_before['white']:
                    is_sacrifice = True
            else:
                if material_after['black'] < material_before['black']:
                    is_sacrifice = True
        # Use new brilliant logic
        quality = determine_move_quality(
            abs_delta, delta, side_to_move, is_book, forced, is_sacrifice,
            eval_after, eval_before, alt_evals=alt_evals
        )
        analysis.append({
            "ply": i + 1,
            "move": san,
            "quality": quality,
            "is_book": is_book
        })
    
    return analysis


def get_moves_needing_review(pgn_data, stockfish_path=None, book_path=None):
    """
    Returns a list of moves that need review (inaccuracy, mistake, blunder, brilliant),
    with context for GPT commentary.
    """
    analysis = analyze_game(pgn_data, stockfish_path, book_path)
    review_qualities = {"inaccuracy", "mistake", "blunder", "brilliant"}
    moves_to_review = []
    for move in analysis:
        if move["quality"] in review_qualities:
            moves_to_review.append(move)
    return moves_to_review


# pgn_data = """[Event "Live Chess"]\n[Site "Chess.com"]\n[Date "2025.04.20"]\n[Round "-"]\n[White "senxdes"]\n[Black "shaxbozaka"]\n[Result "0-1"]\n[CurrentPosition "N6Q/p3bppp/4pk2/1p1p1b2/3N4/1KP5/PP1nP1PP/5R2 w - - 1 22"]\n[Timezone "UTC"]\n[ECO "D00"]\n[ECOUrl "https://www.chess.com/openings/Queens-Pawn-Opening-Accelerated-London-System"]\n[UTCDate "2025.04.20"]\n[UTCTime "02:58:51"]\n[WhiteElo "760"]\n[BlackElo "779"]\n[TimeControl "180+2"]\n[Termination "shaxbozaka won by checkmate"]\n[StartTime "02:58:51"]\n[EndDate "2025.04.20"]\n[EndTime "03:02:26"]\n[Link "https://www.chess.com/game/live/137575323280"]\n\n1. d4 {[%clk 0:03:01.3]} 1... d5 {[%clk 0:03:00.7]} 2. Bf4 {[%clk 0:03:02.7]} 2... Nc6 {[%clk 0:03:01.9]} 3. Nc3 {[%clk 0:03:04.3]} 3... Nxd4 {[%clk 0:03:01.3]} 4. Qxd4 {[%clk 0:03:05]} 4... Nf6 {[%clk 0:03:01.5]} 5. Nb5 {[%clk 0:03:05.4]} 5... Ne4 {[%clk 0:02:33.7]} 6. Nxc7+ {[%clk 0:03:03.6]} 6... Kd7 {[%clk 0:02:31.9]} 7. Nxa8 {[%clk 0:03:04.5]} 7... Qa5+ {[%clk 0:02:23.8]} 8. c3 {[%clk 0:03:03.3]} 8... Qc5 {[%clk 0:02:14.6]} 9. Qa4+ {[%clk 0:03:00.6]} 9... b5 {[%clk 0:02:10.3]} 10. Qa5 {[%clk 0:02:53.9]} 10... Qxf2+ {[%clk 0:02:08.4]} 11. Kd1 {[%clk 0:02:54.2]} 11... Qxf1+ {[%clk 0:02:04.9]} 12. Kc2 {[%clk 0:02:54.1]} 12... Qxf4 {[%clk 0:01:53.6]} 13. Nf3 {[%clk 0:02:54.6]} 13... Nf2 {[%clk 0:01:40.2]} 14. Rhf1 {[%clk 0:02:52.6]} 14... Qf5+ {[%clk 0:01:40.4]} 15. Kb3 {[%clk 0:02:49]} 15... Ne4 {[%clk 0:01:26.5]} 16. Qc7+ {[%clk 0:02:46.1]} 16... Ke6 {[%clk 0:01:17.4]} 17. Nd4+ {[%clk 0:02:46.8]} 17... Kf6 {[%clk 0:01:15.9]} 18. Rxf5+ {[%clk 0:02:47.1]} 18... Bxf5 {[%clk 0:01:17.1]} 19. Rf1 {[%clk 0:02:46.1]} 19... e6 {[%clk 0:01:17.1]} 20. Qd8+ {[%clk 0:02:43.7]} 20... Be7 {[%clk 0:01:15.2]} 21. Qxh8 {[%clk 0:02:43.3]} 21... Nd2# {[%clk 0:01:15.1]} 0-1"""
