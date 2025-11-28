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


def determine_move_quality(abs_delta, delta, side_to_move, is_book, forced, is_sacrifice, played_eval, best_eval, is_checkmate=False, best_move_san=None, is_competitive=True):
    """
    Chess.com-style move quality classification with commentary.

    Brilliant move criteria (Chess.com algorithm as of March 2021):
    1. Must be a sacrifice (gives up material)
    2. Must be the best or nearly best move (doesn't weaken position)
    3. Must be in a competitive position (not already winning by a lot)
    4. In endgame: must be the ONLY good move
    5. In opening/middlegame: can be one of several good options
    """
    comment = ""

    if is_checkmate:
        return "best", "Checkmate! The perfect finishing move."

    if is_book:
        return "book", "Opening theory - a well-established move in this position."

    if forced:
        return "forced", "The only legal move available."

    # Default quality classification (Chess.com thresholds)
    if abs_delta <= 10:
        quality = "best"
        comment = "This is the engine's top choice."
    elif abs_delta <= 25:
        quality = "great"
        comment = "An excellent move - very close to the best option."
    elif abs_delta <= 50:
        quality = "good"
        comment = "A reasonable move that keeps the position solid."
    elif abs_delta <= 100:
        quality = "inaccuracy"
        if best_move_san:
            comment = f"A small slip. {best_move_san} was more accurate."
        else:
            comment = "A small slip - there was a more precise continuation."
    elif abs_delta <= 300:
        quality = "mistake"
        if best_move_san:
            comment = f"This gives away some advantage. {best_move_san} was much better."
        else:
            comment = "This gives away significant advantage. A better move was available."
    else:
        quality = "blunder"
        if played_eval is not None:
            # Check if it's a game-losing blunder
            if side_to_move == chess.WHITE and played_eval < -500:
                comment = "A critical error that likely loses the game."
            elif side_to_move == chess.BLACK and played_eval > 500:
                comment = "A critical error that likely loses the game."
            elif best_move_san:
                comment = f"A serious mistake. {best_move_san} was necessary to stay in the game."
            else:
                comment = "A serious mistake that dramatically worsens the position."
        else:
            comment = "A serious mistake that dramatically worsens the position."

    # Chess.com-style brilliant move detection
    # Based on: https://support.chess.com/en/articles/8572705-how-are-moves-classified
    # "Brilliant moves must sacrifice material and be the best (or nearly best) move"
    # "Must be in a competitive position (not already winning by a lot)"

    if quality in ("best", "great") and is_sacrifice and played_eval is not None and is_competitive:
        # A sacrifice is brilliant if:
        # 1. It sacrifices material (is_sacrifice=True)
        # 2. It's a strong move (best or great quality)
        # 3. The position is competitive (not already winning by too much)
        # 4. The position after the sacrifice is still favorable or equal

        # Check if the sacrifice maintains a reasonable position
        if side_to_move == chess.WHITE:
            # White sacrificed and position is still okay (not losing)
            if played_eval >= -100:  # Allow slight disadvantage after sacrifice
                quality = "brilliant"
                comment = "A brilliant sacrifice! Material is given up but the position remains strong."
        else:
            # Black sacrificed and position is still okay (not losing)
            if played_eval <= 100:  # Allow slight disadvantage after sacrifice
                quality = "brilliant"
                comment = "A brilliant sacrifice! Material is given up but the position remains strong."

    return quality, comment


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


PIECE_VALUES = {
    chess.PAWN: 1,
    chess.KNIGHT: 3,
    chess.BISHOP: 3,
    chess.ROOK: 5,
    chess.QUEEN: 9,
    chess.KING: 0
}


def is_sacrifice_move(board, move):
    """
    Chess.com-style sacrifice detection.
    A move is a sacrifice if you intentionally give up material for positional/tactical compensation.

    True sacrifices:
    1. Putting a piece en prise (can be captured) where you lose material
    2. Exchange sacrifice (Rook for minor piece)
    3. Quality sacrifice where material is genuinely lost

    NOT sacrifices:
    - Normal captures even if piece can be recaptured (Qxf3 taking a defended piece)
    - Trades where material is roughly equal
    """
    moving_piece = board.piece_at(move.from_square)
    if moving_piece is None:
        return False

    moving_value = PIECE_VALUES.get(moving_piece.piece_type, 0)
    side = board.turn

    # Get captured piece value (if any)
    captured_piece = board.piece_at(move.to_square)
    captured_value = PIECE_VALUES.get(captured_piece.piece_type, 0) if captured_piece else 0

    # Make the move temporarily
    board_copy = board.copy()
    board_copy.push(move)

    to_square = move.to_square

    # Check if the moved piece can be captured by opponent
    attackers = board_copy.attackers(not side, to_square)

    if not attackers:
        # Piece is safe after the move
        # Only a sacrifice if we captured something worth much less than our piece
        # E.g., Queen takes undefended pawn is not a sacrifice (piece is safe)
        return False

    # Piece can be taken after the move - calculate net material
    # If opponent recaptures, we lose our piece but keep what we captured
    # Net material change = captured_value - moving_value
    # It's a sacrifice if we lose material (net < 0) AND the loss is significant

    net_material = captured_value - moving_value

    # Check if it's a genuine sacrifice (losing material)
    # A sacrifice must lose at least 2 points of material to be meaningful
    # This excludes normal trades and minor imbalances
    if net_material <= -2:
        # Losing at least 2 points - this is a sacrifice
        # E.g., Knight (3) for pawn (1) = -2, Queen (9) for Rook (5) = -4
        return True

    # Special case: putting a piece en prise without capturing anything
    # E.g., moving a piece to a square where it can be taken
    if captured_value == 0 and moving_value >= 3:
        # Moving a minor piece or higher to an attacked square without taking anything
        defenders = board_copy.attackers(side, to_square)
        if not defenders:
            # Undefended piece sacrifice
            return True
        # Defended but can be taken by lower value piece
        min_attacker_value = min(PIECE_VALUES.get(board_copy.piece_at(sq).piece_type, 0) for sq in attackers)
        if moving_value > min_attacker_value + 2:
            # E.g., putting Knight on square attacked by pawn
            return True

    return False


def count_material(board):
    material = {'white': 0, 'black': 0}
    piece_values = PIECE_VALUES
    
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

        # Check if this move is a sacrifice BEFORE making the move
        is_sacrifice = is_sacrifice_move(curr_board, move)

        curr_board.push(move)
        pos_after_fen = curr_board.fen()
        eval_after = eval_cache.get(pos_after_fen)

        # Check if this move is checkmate or stalemate
        is_checkmate = curr_board.is_checkmate()
        is_stalemate = curr_board.is_stalemate()

        # Calculate centipawn loss (how much worse the played move is vs best move)
        # eval_before is the best eval from the position (what engine would play)
        # eval_after is the eval after the played move
        # For White moving: good move keeps/increases eval, so loss = eval_before - eval_after (if positive = bad)
        # For Black moving: good move decreases eval, so loss = eval_after - eval_before (if positive from black's view = bad)
        delta = 0
        abs_delta = 0

        # Handle checkmate - it's always the best move!
        if is_checkmate:
            abs_delta = 0  # Perfect move, no loss
        elif is_stalemate:
            # Stalemate might be good or bad depending on position
            abs_delta = 0 if eval_before is None or abs(eval_before) < 200 else 100
        elif eval_before is not None and eval_after is not None:
            if side_to_move == chess.WHITE:
                # White wants eval to stay high/increase. Loss = how much eval dropped
                delta = eval_before - eval_after
            else:
                # Black wants eval to decrease. Loss = how much eval increased (bad for black)
                delta = eval_after - eval_before
            # Centipawn loss should be positive when move is worse than best
            abs_delta = max(0, delta)  # Only count as loss if it's actually worse
        # Determine if position is competitive (not already winning by too much)
        # Chess.com: brilliant moves only occur in competitive positions
        is_competitive = True
        if eval_before is not None:
            # If already up by more than 5 pawns (500 centipawns), position is not competitive
            if side_to_move == chess.WHITE and eval_before > 500:
                is_competitive = False
            elif side_to_move == chess.BLACK and eval_before < -500:
                is_competitive = False

        # Use Chess.com-style brilliant logic with commentary
        quality, comment = determine_move_quality(
            abs_delta, delta, side_to_move, is_book, forced, is_sacrifice,
            eval_after, eval_before, is_checkmate=is_checkmate, is_competitive=is_competitive
        )
        analysis.append({
            "ply": i + 1,
            "move": san,
            "quality": quality,
            "is_book": is_book,
            "comment": comment,
            "eval": eval_after / 100 if eval_after is not None else None  # Convert to pawns
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


