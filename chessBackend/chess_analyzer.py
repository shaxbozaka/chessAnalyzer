import chess
import chess.engine
import chess.pgn
import chess.polyglot  # Added for opening book support
from io import StringIO
import os
import concurrent.futures
import math


DEFAULT_STOCKFISH_PATH = "/usr/games/stockfish"
DEFAULT_BOOK_PATH = "/app/bookfish.bin"
DEFAULT_ANALYSIS_DEPTH = 14
DEFAULT_ANALYSIS_WORKERS = 2
DEFAULT_MAX_ANALYSIS_PLIES = 300
DEFAULT_SECONDS_PER_POSITION = 5.0
DEFAULT_MULTIPV = 3


class AnalysisInputError(ValueError):
    """Raised when a submitted PGN/FEN cannot be analyzed."""


class AnalysisConfigError(RuntimeError):
    """Raised when the server-side analysis configuration is invalid."""


def _env_int(name, default, minimum=1):
    try:
        value = int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default
    return max(minimum, value)


def _env_float(name, default, minimum=0.1):
    try:
        value = float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default
    return max(minimum, value)


def _resolve_stockfish_path(stockfish_path=None):
    path = stockfish_path or os.environ.get("STOCKFISH_PATH", DEFAULT_STOCKFISH_PATH)
    if not os.path.isfile(path) or not os.access(path, os.X_OK):
        raise AnalysisConfigError("Stockfish binary is not configured or is not executable.")
    return path


def _resolve_book_path(book_path=None):
    path = book_path or os.environ.get("BOOK_PATH", DEFAULT_BOOK_PATH)
    return path if path and os.path.isfile(path) else None


def _analysis_depth():
    return _env_int("ANALYSIS_DEPTH", DEFAULT_ANALYSIS_DEPTH)


def _analysis_workers(position_count):
    cpu_count = os.cpu_count() or 1
    configured = _env_int("ANALYSIS_WORKERS", DEFAULT_ANALYSIS_WORKERS)
    return max(1, min(configured, cpu_count, position_count))


def _seconds_per_position():
    return _env_float("ANALYSIS_SECONDS_PER_POSITION", DEFAULT_SECONDS_PER_POSITION)


def _multipv():
    return _env_int("ANALYSIS_MULTIPV", DEFAULT_MULTIPV)


def _score_to_cp(score):
    return score.white().score(mate_score=10000)


def _white_expected_score(eval_cp):
    if eval_cp is None:
        return None

    cp = max(-1000, min(1000, eval_cp))
    return 1 / (1 + math.exp(-0.004 * cp))


def _side_expected_score(eval_cp, side):
    white_score = _white_expected_score(eval_cp)
    if white_score is None:
        return None
    return white_score if side == chess.WHITE else 1 - white_score


def _expected_loss(eval_before, eval_after, side):
    before = _side_expected_score(eval_before, side)
    after = _side_expected_score(eval_after, side)
    if before is None or after is None:
        return None
    return max(0, before - after)


def _move_from_uci(move_uci):
    return chess.Move.from_uci(move_uci) if move_uci else None


# Function to check if a move is in the opening book
def is_book_move(board, book_path, cache=None):
    if not book_path:
        return False

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


def determine_move_quality(abs_delta, delta, side_to_move, is_book, forced, is_sacrifice, played_eval, best_eval, is_checkmate=False, best_move_san=None, is_competitive=True, move_problem=None, is_miss=False, expected_loss=None, top_move_rank=None):
    """
    Chess.com-style move quality classification with commentary.

    Brilliant move criteria (Chess.com algorithm as of March 2021):
    1. Must be a sacrifice (gives up material)
    2. Must be the best or nearly best move (doesn't weaken position)
    3. Must be in a competitive position (not already winning by a lot)
    4. In endgame: must be the ONLY good move
    5. In opening/middlegame: can be one of several good options

    Miss: When the best move would have won significant material or created a winning advantage,
    but the player played a move that doesn't lose material (so not a blunder).

    move_problem: Dict from analyze_move_problem() with type, description, material_lost
    """
    comment = ""

    if is_checkmate:
        return "best", "Checkmate! The perfect finishing move."

    if is_book:
        return "book", "Opening theory - a well-established move in this position."

    if forced:
        return "forced", "The only legal move available."

    # Chess.com thresholds (based on reverse-engineering and public info):
    # - Best: exactly the engine's top choice (0 cp loss)
    # - Excellent: very close to best (1-10 cp loss)
    # - Good: solid move (11-30 cp loss)
    # - Inaccuracy: small mistake (31-80 cp loss)
    # - Mistake: significant error (81-200 cp loss)
    # - Blunder: game-changing error (201+ cp loss)
    # - Miss: missed a winning tactic (special - doesn't lose material but misses a win)

    expected_loss_pct = expected_loss * 100 if expected_loss is not None else None

    # Check for "Miss" first - this is when you miss a winning tactic
    # A miss is when: you could have won material/game but played a safe move instead
    if is_miss and (
        (expected_loss_pct is not None and 4 <= expected_loss_pct < 18)
        or (expected_loss_pct is None and abs_delta >= 50 and abs_delta < 200)
    ):
        quality = "miss"
        if best_move_san:
            comment = f"Missed a winning move! {best_move_san} would have given a decisive advantage."
        else:
            comment = "Missed a winning continuation that would have given a decisive advantage."
        return quality, comment

    if expected_loss_pct is not None:
        if top_move_rank == 1 or expected_loss_pct <= 0.3:
            quality = "best"
            comment = "This is the engine's top choice."
        elif expected_loss_pct <= 1.5 or (top_move_rank is not None and expected_loss_pct <= 2.5):
            quality = "excellent"
            comment = "An excellent move - nearly as good as the best."
        elif expected_loss_pct <= 4:
            quality = "good"
            comment = "A reasonable move that keeps the position solid."
        elif expected_loss_pct <= 8:
            quality = "inaccuracy"
            if move_problem and move_problem.get("description"):
                comment = move_problem["description"]
                if best_move_san:
                    comment += f" {best_move_san} was more accurate."
            elif best_move_san:
                comment = f"A small slip. {best_move_san} was more accurate."
            else:
                comment = "A small slip - there was a more precise continuation."
        elif expected_loss_pct <= 18:
            quality = "mistake"
            if move_problem and move_problem.get("description"):
                comment = move_problem["description"]
                if best_move_san:
                    comment += f" {best_move_san} was better."
            elif best_move_san:
                comment = f"This gives away some advantage. {best_move_san} was much better."
            else:
                comment = "This gives away significant advantage. A better move was available."
        else:
            quality = "blunder"
            if move_problem and move_problem.get("description"):
                comment = move_problem["description"]
                if best_move_san:
                    comment += f" {best_move_san} was necessary."
            elif played_eval is not None:
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
    else:
        if abs_delta <= 0:
            quality = "best"
            comment = "This is the engine's top choice."
        elif abs_delta <= 10:
            quality = "excellent"
            comment = "An excellent move - nearly as good as the best."
        elif abs_delta <= 30:
            quality = "good"
            comment = "A reasonable move that keeps the position solid."
        elif abs_delta <= 80:
            quality = "inaccuracy"
            # Use problem description if available
            if move_problem and move_problem.get("description"):
                comment = move_problem["description"]
                if best_move_san:
                    comment += f" {best_move_san} was more accurate."
            elif best_move_san:
                comment = f"A small slip. {best_move_san} was more accurate."
            else:
                comment = "A small slip - there was a more precise continuation."
        elif abs_delta <= 200:
            quality = "mistake"
            # Use problem description if available
            if move_problem and move_problem.get("description"):
                comment = move_problem["description"]
                if best_move_san:
                    comment += f" {best_move_san} was better."
            elif best_move_san:
                comment = f"This gives away some advantage. {best_move_san} was much better."
            else:
                comment = "This gives away significant advantage. A better move was available."
        else:
            quality = "blunder"
            # Use problem description first - this explains WHY the move is bad
            if move_problem and move_problem.get("description"):
                comment = move_problem["description"]
                if best_move_san:
                    comment += f" {best_move_san} was necessary."
            elif played_eval is not None:
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

    if quality in ("best", "excellent") and is_sacrifice and played_eval is not None and is_competitive:
        # A sacrifice is brilliant if:
        # 1. It sacrifices material (is_sacrifice=True)
        # 2. It's a strong move (best or excellent quality)
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
    """Evaluate a single position using Stockfish and get best move"""
    fen, stockfish_path, depth, time_limit, multipv = position_data
    position = chess.Board(fen)

    # Evaluate the position and get best move
    eval_score = None
    best_move = None
    top_moves = []
    engine = None
    try:
        # Create a new engine instance for this process
        engine = chess.engine.SimpleEngine.popen_uci(stockfish_path)

        # Configure engine for accurate analysis with bounded per-process cost.
        engine.configure({
            "Threads": 1,
            "Hash": 64,
        })

        raw_info = engine.analyse(
            position,
            chess.engine.Limit(depth=depth, time=time_limit),
            multipv=multipv
        )
        info_items = raw_info if isinstance(raw_info, list) else [raw_info]
        info_items.sort(key=lambda item: item.get("multipv", 1))

        for info in info_items:
            pv = info.get("pv", [])
            if not pv:
                continue

            move = pv[0]
            score = _score_to_cp(info["score"])
            top_moves.append({
                "move": position.san(move),
                "move_uci": move.uci(),
                "eval": score / 100 if score is not None else None,
                "eval_cp": score
            })

        if top_moves:
            eval_score = top_moves[0]["eval_cp"]
            best_move = top_moves[0]["move_uci"]
    except Exception as e:
        print(f"Error evaluating position: {e}")
    finally:
        if engine is not None:
            engine.quit()

    return fen, eval_score, best_move, top_moves


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
    1. Putting a piece en prise (can be captured) where you LOSE material
    2. Exchange sacrifice (Rook for minor piece)
    3. Quality sacrifice where material is genuinely lost

    NOT sacrifices:
    - Normal captures even if piece can be recaptured
    - Trades where material is roughly equal (Queen trade, minor piece trade)
    - Defensive moves like blocking check with a piece (even if it can be taken)
    - Interpositions where the trade would be equal
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
        # Piece is safe after the move - not a sacrifice
        return False

    # Find the minimum value attacker
    min_attacker_value = float('inf')
    for sq in attackers:
        attacker = board_copy.piece_at(sq)
        if attacker:
            min_attacker_value = min(min_attacker_value, PIECE_VALUES.get(attacker.piece_type, 0))

    # Calculate the ACTUAL material loss if opponent recaptures with best piece
    # Material loss = what we lose (our piece) - what we captured - what opponent loses (their attacker if we recapture)

    # Check if we can recapture after opponent takes
    defenders = board_copy.attackers(side, to_square)
    can_recapture = len(defenders) > 0

    if can_recapture:
        # If we can recapture, the exchange is: we lose our piece, gain what we captured, gain their attacker
        # Net = captured_value + min_attacker_value - moving_value
        # For equal trade (Q takes Q): 9 + 9 - 9 = 9 (we're up the captured piece) - but that's wrong
        # Actually: Q moves to e7, opponent Q takes, we recapture with something
        # Net: -9 (our Q) + 0 (nothing captured) + 9 (their Q) = 0 (even trade)

        # Simple case: If our piece equals the attacker's piece, it's an equal trade, NOT a sacrifice
        if moving_value == min_attacker_value and captured_value == 0:
            return False

        # If we captured something and can trade evenly, not a sacrifice
        if moving_value == min_attacker_value:
            return False

    # Net material if opponent simply captures us (ignoring recapture for now)
    # We lose: moving_value, we gain: captured_value
    immediate_net = captured_value - moving_value

    # It's only a sacrifice if:
    # 1. We're putting a piece where it can be captured by a LOWER VALUE piece (losing material)
    # 2. OR we're putting an undefended piece en prise

    # Case 1: Undefended piece put en prise
    if not defenders and captured_value == 0 and moving_value >= 3:
        # Giving away a piece for nothing - this is a sacrifice
        return True

    # Case 2: Can be captured by lower value piece even if defended
    if min_attacker_value < moving_value:
        # E.g., Knight on a square attacked by pawn
        net_loss = moving_value - min_attacker_value - captured_value
        if net_loss >= 2:
            return True

    # Case 3: We captured something but lose more
    if captured_value > 0 and immediate_net <= -2:
        # E.g., Knight takes pawn but knight is hanging (lose 2+ material)
        if not defenders:
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


def is_missed_win(board_before, best_move, played_move, eval_before, eval_after, side_to_move):
    """
    Detect if a move is a "Miss" - when the player missed a winning opportunity.

    Chess.com's "Miss" classification:
    - Best move would win significant material or give a big advantage
    - Played move is relatively safe (doesn't lose material immediately)
    - The opportunity to win was there but the player played a "neutral" move instead

    Examples:
    - Missing a tactic that wins a piece
    - Missing a forced checkmate sequence
    - Missing a combination that wins the exchange
    """
    if best_move is None or played_move is None:
        return False

    if eval_before is None or eval_after is None:
        return False

    # Calculate how much was lost by not playing the best move
    if side_to_move == chess.WHITE:
        cp_loss = eval_before - eval_after
    else:
        cp_loss = eval_after - eval_before

    # For a "miss", the loss should be significant but not catastrophic
    # (catastrophic would be a blunder)
    if cp_loss < 50 or cp_loss > 200:
        return False

    # The best move should have given a significant advantage
    # Check if best move would have won material or given winning advantage
    best_would_give_advantage = False

    if side_to_move == chess.WHITE:
        # White's best move should maintain or create advantage
        if eval_before >= 100:  # Best move keeps us ahead
            best_would_give_advantage = True
    else:
        # Black's best move should maintain or create advantage
        if eval_before <= -100:  # Best move keeps us ahead
            best_would_give_advantage = True

    # Also check if the best move was a capture or winning tactic
    # by looking at what the best move does
    if best_move:
        # Check if best move is a capture
        captured = board_before.piece_at(best_move.to_square)
        if captured is not None:
            captured_value = PIECE_VALUES.get(captured.piece_type, 0)
            if captured_value >= 3:  # Captures minor piece or better
                best_would_give_advantage = True

    # The played move should not be losing material (that would be mistake/blunder)
    # A "miss" is when you play a safe move instead of winning
    board_after_played = board_before.copy()
    board_after_played.push(played_move)

    # Check if the played move hangs a piece
    played_hangs_piece = False
    to_sq = played_move.to_square
    attackers = board_after_played.attackers(not side_to_move, to_sq)
    defenders = board_after_played.attackers(side_to_move, to_sq)

    if attackers and not defenders:
        moving_piece = board_before.piece_at(played_move.from_square)
        if moving_piece:
            moving_value = PIECE_VALUES.get(moving_piece.piece_type, 0)
            if moving_value >= 3:
                played_hangs_piece = True

    # If played move hangs a piece, it's more likely a mistake/blunder than a miss
    if played_hangs_piece:
        return False

    return best_would_give_advantage


PIECE_NAMES = {
    chess.PAWN: "pawn",
    chess.KNIGHT: "knight",
    chess.BISHOP: "bishop",
    chess.ROOK: "rook",
    chess.QUEEN: "queen",
    chess.KING: "king"
}


def analyze_move_problem(board_before, move, board_after):
    """
    Analyze what went wrong with a move.
    Returns a dict with problem type and description.

    Problem types:
    - hanging_piece: Moved piece is now undefended and can be captured
    - bad_trade: Captured something but lose more in return
    - missed_capture: Could have captured an undefended piece
    - allows_checkmate: Move allows opponent to checkmate
    - allows_check: Move walks into check or allows dangerous check
    - leaves_piece_hanging: Move leaves another piece undefended
    - allows_tactic: Move allows opponent fork/pin/skewer
    """
    result = {
        "type": None,
        "description": None,
        "material_lost": 0
    }

    moving_piece = board_before.piece_at(move.from_square)
    if moving_piece is None:
        return result

    moving_piece_name = PIECE_NAMES.get(moving_piece.piece_type, "piece")
    moving_value = PIECE_VALUES.get(moving_piece.piece_type, 0)
    side = board_before.turn

    # What did we capture (if anything)?
    captured_piece = board_before.piece_at(move.to_square)
    captured_value = PIECE_VALUES.get(captured_piece.piece_type, 0) if captured_piece else 0
    captured_name = PIECE_NAMES.get(captured_piece.piece_type, "piece") if captured_piece else None

    to_square = move.to_square
    to_square_name = chess.square_name(to_square)

    # Check if move allows checkmate
    if board_after.is_checkmate():
        # This shouldn't happen (we lost), but just in case
        pass

    # Check if opponent can now checkmate us
    for opp_move in board_after.legal_moves:
        board_test = board_after.copy()
        board_test.push(opp_move)
        if board_test.is_checkmate():
            result["type"] = "allows_checkmate"
            result["description"] = f"This move allows checkmate! Your opponent can play {board_after.san(opp_move)} for mate."
            return result

    # Check if we're now in check (king walked into danger)
    if board_after.is_check():
        # Find what's giving check
        our_king_sq = board_after.king(side)
        checkers = board_after.attackers(not side, our_king_sq)
        if checkers:
            checker_sq = list(checkers)[0]
            checker = board_after.piece_at(checker_sq)
            if checker:
                checker_name = PIECE_NAMES.get(checker.piece_type, "piece")
                result["type"] = "walked_into_check"
                result["description"] = f"You walked into check from the {checker_name}!"
                return result

    # Check if our piece is now hanging (can be captured)
    attackers = board_after.attackers(not side, to_square)
    defenders = board_after.attackers(side, to_square)

    if attackers:
        min_attacker_value = float('inf')
        for sq in attackers:
            attacker = board_after.piece_at(sq)
            if attacker:
                min_attacker_value = min(min_attacker_value, PIECE_VALUES.get(attacker.piece_type, 0))

        if not defenders:
            net_loss = moving_value - captured_value
            if net_loss > 0:
                result["type"] = "hanging_piece"
                result["material_lost"] = net_loss
                if captured_piece:
                    result["description"] = f"You captured the {captured_name} but left your {moving_piece_name} undefended on {to_square_name}. You lose {net_loss} points of material."
                else:
                    result["description"] = f"Your {moving_piece_name} on {to_square_name} is undefended and can be captured for free!"
                return result
        else:
            if min_attacker_value < moving_value:
                net_loss = moving_value - min_attacker_value - captured_value
                if net_loss >= 2:
                    result["type"] = "bad_trade"
                    result["material_lost"] = net_loss
                    result["description"] = f"Your {moving_piece_name} can be captured by a lower-value piece. This loses material even if you recapture."
                    return result

    # Check if we left another piece hanging by moving
    # (The piece we moved might have been defending something)
    for sq in chess.SQUARES:
        our_piece = board_after.piece_at(sq)
        if our_piece and our_piece.color == side and sq != to_square:
            piece_value = PIECE_VALUES.get(our_piece.piece_type, 0)
            if piece_value >= 3:  # Only check for minor pieces and above
                attackers = board_after.attackers(not side, sq)
                defenders = board_after.attackers(side, sq)

                # Was this piece defended before but not now?
                was_defended = len(board_before.attackers(side, sq)) > 0
                is_defended = len(defenders) > 0
                is_attacked = len(attackers) > 0

                if is_attacked and not is_defended:
                    piece_name = PIECE_NAMES.get(our_piece.piece_type, "piece")
                    result["type"] = "leaves_piece_hanging"
                    result["material_lost"] = piece_value
                    result["description"] = f"This move leaves your {piece_name} on {chess.square_name(sq)} undefended!"
                    return result

    # Check if we missed capturing an undefended piece
    for sq in chess.SQUARES:
        target = board_before.piece_at(sq)
        if target and target.color != side:
            target_value = PIECE_VALUES.get(target.piece_type, 0)
            if sq in board_before.attacks(move.from_square):
                target_defenders = board_before.attackers(not side, sq)
                if not target_defenders and target_value > captured_value:
                    target_name = PIECE_NAMES.get(target.piece_type, "piece")
                    result["type"] = "missed_capture"
                    result["description"] = f"You could have captured the undefended {target_name} on {chess.square_name(sq)} instead!"
                    return result

    return result


def _parse_game(pgn_data):
    if not pgn_data or not pgn_data.strip():
        raise AnalysisInputError("PGN data is required.")

    game = chess.pgn.read_game(StringIO(pgn_data.strip()))
    if game is None:
        raise AnalysisInputError("Unable to parse PGN data.")
    return game


def analyze_position(fen, stockfish_path=None):
    try:
        board = chess.Board(fen)
    except ValueError as exc:
        raise AnalysisInputError("Invalid FEN position.") from exc

    stockfish_path = _resolve_stockfish_path(stockfish_path)
    eval_score, best_move_uci, top_moves = _evaluate_board(board, stockfish_path)

    best_move_san = None
    if best_move_uci is not None:
        best_move = _move_from_uci(best_move_uci)
        try:
            best_move_san = board.san(best_move)
        except ValueError:
            best_move_san = best_move_uci

    return {
        "fen": board.fen(),
        "eval": eval_score / 100 if eval_score is not None else None,
        "best_move": best_move_san,
        "best_move_uci": best_move_uci,
        "top_moves": top_moves
    }


def _evaluate_board(board, stockfish_path):
    _, eval_score, best_move, top_moves = evaluate_position(
        (board.fen(), stockfish_path, _analysis_depth(), _seconds_per_position(), _multipv())
    )
    return eval_score, best_move, top_moves


def _parse_legal_move(board, move_text):
    try:
        return board.parse_san(move_text)
    except ValueError:
        pass

    try:
        move = chess.Move.from_uci(move_text)
    except ValueError as exc:
        raise AnalysisInputError("Move must be legal SAN or UCI notation.") from exc

    if move not in board.legal_moves:
        raise AnalysisInputError("Move is not legal in the provided position.")
    return move


def analyze_candidate_move(fen, move_text, stockfish_path=None):
    try:
        board = chess.Board(fen)
    except ValueError as exc:
        raise AnalysisInputError("Invalid FEN position.") from exc

    move = _parse_legal_move(board, move_text)
    stockfish_path = _resolve_stockfish_path(stockfish_path)
    san = board.san(move)
    side_to_move = board.turn
    eval_before, best_move_uci, top_moves = _evaluate_board(board, stockfish_path)
    played_line = next((line for line in top_moves if line.get("move_uci") == move.uci()), None)
    top_move_rank = top_moves.index(played_line) + 1 if played_line else None

    best_move_san = None
    best_move = _move_from_uci(best_move_uci)
    if best_move and best_move != move:
        try:
            best_move_san = board.san(best_move)
        except ValueError:
            best_move_san = best_move_uci

    is_sacrifice = is_sacrifice_move(board, move)
    board_before = board.copy()
    board.push(move)
    eval_after, _, _ = _evaluate_board(board, stockfish_path)
    played_eval_for_loss = played_line.get("eval_cp") if played_line else eval_after
    move_problem = analyze_move_problem(board_before, move, board)
    is_checkmate = board.is_checkmate()
    is_stalemate = board.is_stalemate()

    delta = 0
    abs_delta = 0
    if is_checkmate:
        abs_delta = 0
    elif is_stalemate:
        abs_delta = 0 if eval_before is None or abs(eval_before) < 200 else 100
    elif eval_before is not None and played_eval_for_loss is not None:
        if side_to_move == chess.WHITE:
            delta = eval_before - played_eval_for_loss
        else:
            delta = played_eval_for_loss - eval_before
        abs_delta = min(max(0, delta), 800)

    expected_loss = _expected_loss(eval_before, played_eval_for_loss, side_to_move)

    is_competitive = True
    if eval_before is not None:
        if side_to_move == chess.WHITE and eval_before > 500:
            is_competitive = False
        elif side_to_move == chess.BLACK and eval_before < -500:
            is_competitive = False

    is_miss = is_missed_win(board_before, best_move, move, eval_before, played_eval_for_loss, side_to_move)
    quality, comment = determine_move_quality(
        abs_delta, delta, side_to_move, False, False, is_sacrifice,
        eval_after, eval_before, is_checkmate=is_checkmate, best_move_san=best_move_san,
        is_competitive=is_competitive, move_problem=move_problem, is_miss=is_miss,
        expected_loss=expected_loss, top_move_rank=top_move_rank
    )

    return {
        "ply": 1,
        "move": san,
        "quality": quality,
        "is_book": False,
        "comment": comment,
        "eval": eval_after / 100 if eval_after is not None else None,
        "eval_before": eval_before / 100 if eval_before is not None else None,
        "best_move": best_move_san,
        "cp_loss": abs_delta,
        "expected_loss": round(expected_loss * 100, 2) if expected_loss is not None else None,
        "top_moves": top_moves
    }


def analyze_game(pgn_data, stockfish_path=None, book_path=None):
    game = _parse_game(pgn_data)

    # Use environment variables if parameters are not provided
    stockfish_path = _resolve_stockfish_path(stockfish_path)
    book_path = _resolve_book_path(book_path)
    board = game.board()
    
    # Process all moves at once to prepare the analysis
    moves = list(game.mainline_moves())
    max_plies = _env_int("MAX_ANALYSIS_PLIES", DEFAULT_MAX_ANALYSIS_PLIES)
    if len(moves) > max_plies:
        raise AnalysisInputError(f"Game is too long to analyze. Maximum supported plies: {max_plies}.")
    if not moves:
        return []

    positions = []
    
    # Setup the initial board
    curr_board = board.copy()
    positions.append(curr_board.copy())
    
    # Generate all positions after each move
    for move in moves:
        curr_board.push(move)
        positions.append(curr_board.copy())
    
    analysis_depth = _analysis_depth()
    time_limit = _seconds_per_position()
    multipv = _multipv()
    
    # Prepare unique positions for parallel processing.
    unique_positions = list(dict.fromkeys(pos.fen() for pos in positions))
    position_data = [
        (fen, stockfish_path, analysis_depth, time_limit, multipv)
        for fen in unique_positions
    ]
    
    # Create evaluation cache (stores both eval and best move)
    eval_cache = {}
    best_move_cache = {}
    top_moves_cache = {}

    max_workers = _analysis_workers(len(position_data))

    # Process positions in parallel using ProcessPoolExecutor
    with concurrent.futures.ProcessPoolExecutor(max_workers=max_workers) as executor:
        # Submit all position evaluations in parallel
        futures = [executor.submit(evaluate_position, data) for data in position_data]

        # Collect results as they complete
        for future in concurrent.futures.as_completed(futures):
            try:
                fen, score, best_move, top_moves = future.result()
                eval_cache[fen] = score
                best_move_cache[fen] = best_move
                top_moves_cache[fen] = top_moves
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

        # Get the best move from cache and convert to SAN
        best_move_uci = best_move_cache.get(pos_before_fen)
        top_moves = top_moves_cache.get(pos_before_fen, [])
        played_line = next((line for line in top_moves if line.get("move_uci") == move.uci()), None)
        top_move_rank = top_moves.index(played_line) + 1 if played_line else None
        best_move_san = None
        if best_move_uci and best_move_uci != move.uci():
            try:
                best_move_san = curr_board.san(_move_from_uci(best_move_uci))
            except ValueError:
                pass

        # Check if this move is a sacrifice BEFORE making the move
        is_sacrifice = is_sacrifice_move(curr_board, move)

        # Store board state before move for problem analysis
        board_before = curr_board.copy()

        curr_board.push(move)
        pos_after_fen = curr_board.fen()
        eval_after = eval_cache.get(pos_after_fen)
        played_eval_for_loss = played_line.get("eval_cp") if played_line else eval_after

        # Analyze what went wrong with this move (for bad moves)
        move_problem = analyze_move_problem(board_before, move, curr_board)

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
        elif eval_before is not None and played_eval_for_loss is not None:
            if side_to_move == chess.WHITE:
                # White wants eval to stay high/increase. Loss = how much eval dropped
                delta = eval_before - played_eval_for_loss
            else:
                # Black wants eval to decrease. Loss = how much eval increased (bad for black)
                delta = played_eval_for_loss - eval_before
            # Centipawn loss should be positive when move is worse than best
            abs_delta = max(0, delta)  # Only count as loss if it's actually worse
            # Cap cp_loss to 800 to prevent mate scores from skewing accuracy
            abs_delta = min(abs_delta, 800)

        expected_loss = _expected_loss(eval_before, played_eval_for_loss, side_to_move)
        # Determine if position is competitive (not already winning by too much)
        # Chess.com: brilliant moves only occur in competitive positions
        is_competitive = True
        if eval_before is not None:
            # If already up by more than 5 pawns (500 centipawns), position is not competitive
            if side_to_move == chess.WHITE and eval_before > 500:
                is_competitive = False
            elif side_to_move == chess.BLACK and eval_before < -500:
                is_competitive = False

        # Check for "Miss" - missed winning opportunity
        best_move_obj = _move_from_uci(best_move_uci)
        is_miss = is_missed_win(board_before, best_move_obj, move, eval_before, played_eval_for_loss, side_to_move)

        # Use Chess.com-style brilliant logic with commentary
        quality, comment = determine_move_quality(
            abs_delta, delta, side_to_move, is_book, forced, is_sacrifice,
            eval_after, eval_before, is_checkmate=is_checkmate, best_move_san=best_move_san,
            is_competitive=is_competitive, move_problem=move_problem, is_miss=is_miss,
            expected_loss=expected_loss, top_move_rank=top_move_rank
        )
        analysis.append({
            "ply": i + 1,
            "move": san,
            "quality": quality,
            "is_book": is_book,
            "comment": comment,
            "eval": eval_after / 100 if eval_after is not None else None,  # Convert to pawns
            "eval_before": eval_before / 100 if eval_before is not None else None,  # For accuracy calculation
            "best_move": best_move_san,  # Include best move for mistakes/inaccuracies
            "cp_loss": abs_delta,  # Centipawn loss for accuracy calculation
            "expected_loss": round(expected_loss * 100, 2) if expected_loss is not None else None,
            "top_moves": top_moves
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
