#!/usr/bin/env python3
"""
Analyze multiple Chess.com games for brilliant moves
"""
import requests
import os
import sys
from datetime import datetime

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import chess_analyzer

def get_recent_games(username, num_games=50):
    """Fetch recent games from Chess.com API"""
    # Get list of archives (monthly game collections)
    archives_url = f"https://api.chess.com/pub/player/{username}/games/archives"
    headers = {"User-Agent": "ChessAnalyzer/1.0"}

    print(f"Fetching games for {username}...")
    response = requests.get(archives_url, headers=headers)
    if response.status_code != 200:
        print(f"Error fetching archives: {response.status_code}")
        return []

    archives = response.json().get("archives", [])
    if not archives:
        print("No game archives found")
        return []

    # Fetch games from most recent archives until we have enough
    all_games = []
    for archive_url in reversed(archives):  # Start from most recent
        response = requests.get(archive_url, headers=headers)
        if response.status_code == 200:
            games = response.json().get("games", [])
            all_games.extend(reversed(games))  # Most recent first
            if len(all_games) >= num_games:
                break

    return all_games[:num_games]

def analyze_games_for_brilliants(username, num_games=50):
    """Analyze games and count brilliant moves"""
    stockfish_path = os.environ.get('STOCKFISH_PATH', '/opt/homebrew/bin/stockfish')
    book_path = os.environ.get('BOOK_PATH', '/Users/shaxbozaka/projects/chessAnalyzer/chessBackend/src/bookfish.bin')

    games = get_recent_games(username, num_games)
    if not games:
        print("No games to analyze")
        return

    print(f"\nAnalyzing {len(games)} games...\n")

    total_brilliant = 0
    total_great = 0
    total_best = 0
    total_blunders = 0
    total_mistakes = 0
    games_with_brilliants = []

    for i, game in enumerate(games):
        pgn = game.get("pgn", "")
        if not pgn:
            continue

        # Get game info
        white = game.get("white", {}).get("username", "Unknown")
        black = game.get("black", {}).get("username", "Unknown")
        end_time = game.get("end_time", 0)
        game_date = datetime.fromtimestamp(end_time).strftime("%Y-%m-%d") if end_time else "Unknown"
        time_class = game.get("time_class", "Unknown")

        player_color = "white" if white.lower() == username.lower() else "black"
        opponent = black if player_color == "white" else white

        print(f"[{i+1}/{len(games)}] {game_date} vs {opponent} ({time_class})...", end=" ", flush=True)

        try:
            analysis = chess_analyzer.analyze_game(pgn, stockfish_path, book_path)

            # Count move qualities for the player
            player_brilliants = 0
            player_greats = 0
            player_bests = 0
            player_blunders = 0
            player_mistakes = 0

            for idx, move in enumerate(analysis):
                # White moves are even indices (0, 2, 4...), Black moves are odd (1, 3, 5...)
                is_player_move = (idx % 2 == 0 and player_color == "white") or \
                                 (idx % 2 == 1 and player_color == "black")

                if is_player_move:
                    quality = move.get("quality", "")
                    if quality == "brilliant":
                        player_brilliants += 1
                    elif quality == "great":
                        player_greats += 1
                    elif quality == "best":
                        player_bests += 1
                    elif quality == "blunder":
                        player_blunders += 1
                    elif quality == "mistake":
                        player_mistakes += 1

            total_brilliant += player_brilliants
            total_great += player_greats
            total_best += player_bests
            total_blunders += player_blunders
            total_mistakes += player_mistakes

            if player_brilliants > 0:
                games_with_brilliants.append({
                    "date": game_date,
                    "opponent": opponent,
                    "color": player_color,
                    "brilliants": player_brilliants,
                    "time_class": time_class,
                    "url": game.get("url", "")
                })

            print(f"✨ {player_brilliants} brilliant, {player_greats} great, {player_bests} best")

        except Exception as e:
            print(f"Error: {e}")
            continue

    # Print summary
    print("\n" + "="*60)
    print(f"ANALYSIS COMPLETE - {username}'s last {len(games)} games")
    print("="*60)
    print(f"\n✨ Total Brilliant Moves: {total_brilliant}")
    print(f"⭐ Total Great Moves: {total_great}")
    print(f"✅ Total Best Moves: {total_best}")
    print(f"❌ Total Mistakes: {total_mistakes}")
    print(f"💥 Total Blunders: {total_blunders}")

    if games_with_brilliants:
        print(f"\n📊 Games with brilliant moves ({len(games_with_brilliants)}):")
        for g in games_with_brilliants:
            print(f"   - {g['date']} vs {g['opponent']} ({g['color']}, {g['time_class']}): {g['brilliants']} brilliant")
            if g['url']:
                print(f"     {g['url']}")
    else:
        print("\n😔 No brilliant moves found in these games")

    return {
        "brilliant": total_brilliant,
        "great": total_great,
        "best": total_best,
        "mistakes": total_mistakes,
        "blunders": total_blunders,
        "games_analyzed": len(games),
        "games_with_brilliants": games_with_brilliants
    }

if __name__ == "__main__":
    username = sys.argv[1] if len(sys.argv) > 1 else "shaxbozaka"
    num_games = int(sys.argv[2]) if len(sys.argv) > 2 else 50

    analyze_games_for_brilliants(username, num_games)
