import os
import chess
import chess.engine

_ANALYSIS_DEPTH = 20
_CHAT_SANITY_DEPTH = 14
_CHAT_MAX_SCORE_LOSS_CP = 140
_DEFAULT_MULTIPV = 3
_MAX_HANGING_PIECES = 4
_PIECE_VALUES = {
    chess.PAWN: 100,
    chess.KNIGHT: 320,
    chess.BISHOP: 330,
    chess.ROOK: 500,
    chess.QUEEN: 900,
}


def _get_engine_path() -> str:
    path = os.environ.get("STOCKFISH_PATH")
    if not path:
        raise RuntimeError("STOCKFISH_PATH non impostata nelle variabili d'ambiente")
    return path


def get_best_move(fen: str, skill_level: int) -> str:
    """Restituisce la mossa migliore in notazione UCI (es. 'e2e4')."""
    with chess.engine.SimpleEngine.popen_uci(_get_engine_path()) as engine:
        engine.configure({"Skill Level": skill_level})
        board = chess.Board(fen)
        result = engine.play(board, chess.engine.Limit(time=0.1))
        return result.move.uci()


def analyze_position(fen: str) -> dict:
    """
    Analizza la posizione con depth 20.
    Restituisce: { score, best_move, depth }
    score e' in centipawns (int) o stringa 'mate N'.
    """
    with chess.engine.SimpleEngine.popen_uci(_get_engine_path()) as engine:
        board = chess.Board(fen)
        info = engine.analyse(board, chess.engine.Limit(depth=_ANALYSIS_DEPTH))
        return _extract_info(info)


def analyze_position_rich(
    fen: str,
    *,
    depth: int = _ANALYSIS_DEPTH,
    multipv: int = _DEFAULT_MULTIPV,
    approved_score_loss_cp: int = _CHAT_MAX_SCORE_LOSS_CP,
) -> dict:
    """
    Analisi piu' ricca per grounding del coach.
    Restituisce score/base + shortlist candidate + facts tattici semplici.
    """
    with chess.engine.SimpleEngine.popen_uci(_get_engine_path()) as engine:
        board = chess.Board(fen)
        info = engine.analyse(board, chess.engine.Limit(depth=depth), multipv=multipv)

    if isinstance(info, list):
        lines = info
        primary = info[0] if info else {}
    else:
        lines = [info]
        primary = info

    base = _extract_info(primary)
    candidates = _extract_candidate_lines(board, lines)
    approved_moves = [
        candidate["san"]
        for candidate in candidates
        if candidate.get("score_loss_cp") is not None and candidate["score_loss_cp"] <= approved_score_loss_cp
    ]
    if not approved_moves and candidates:
        approved_moves = [candidates[0]["san"]]

    return {
        **base,
        "candidates": candidates,
        "approved_moves": approved_moves,
        "facts": _extract_position_facts(board),
        "position_profile": _build_position_profile(board, approved_moves),
    }


def get_hint(fen: str) -> dict:
    """
    Analisi depth 20 per i suggerimenti in-game.
    Stessa struttura di analyze_position.
    """
    with chess.engine.SimpleEngine.popen_uci(_get_engine_path()) as engine:
        board = chess.Board(fen)
        info = engine.analyse(board, chess.engine.Limit(depth=_ANALYSIS_DEPTH))
        return _extract_info(info)


def is_chat_move_sane(fen: str, san: str, max_score_loss_cp: int = _CHAT_MAX_SCORE_LOSS_CP) -> dict:
    """
    Verifica se una mossa concreta suggerita in chat e' almeno ragionevole tatticamente.
    Restituisce:
    {
        legal: bool,
        sane: bool,
        score_loss_cp: int | None,
        best_move: str | None,
        candidate_move: str | None,
    }
    """
    board = chess.Board(fen)
    mover = board.turn

    try:
        candidate_move = board.parse_san(san)
    except ValueError:
        return {
            "legal": False,
            "sane": False,
            "score_loss_cp": None,
            "best_move": None,
            "candidate_move": None,
        }

    with chess.engine.SimpleEngine.popen_uci(_get_engine_path()) as engine:
        before_info = engine.analyse(board, chess.engine.Limit(depth=_CHAT_SANITY_DEPTH))
        best_score = _score_to_centipawns(before_info["score"], mover)
        best_move = before_info["pv"][0].uci() if before_info.get("pv") else None

        board.push(candidate_move)
        after_info = engine.analyse(board, chess.engine.Limit(depth=_CHAT_SANITY_DEPTH))
        candidate_score = _score_to_centipawns(after_info["score"], mover)

    score_loss = best_score - candidate_score

    return {
        "legal": True,
        "sane": score_loss <= max_score_loss_cp,
        "score_loss_cp": score_loss,
        "best_move": best_move,
        "candidate_move": candidate_move.uci(),
    }


def _extract_info(info: dict) -> dict:
    score_obj = info["score"].relative
    if score_obj.is_mate():
        score = f"mate {score_obj.mate()}"
    else:
        score = score_obj.score(mate_score=10000)

    best_move = info["pv"][0].uci() if info.get("pv") else None

    return {
        "score": score,
        "best_move": best_move,
        "depth": info.get("depth", 0),
    }


def _extract_candidate_lines(board: chess.Board, infos: list[dict]) -> list[dict]:
    candidates = []
    best_score_cp: int | None = None

    for info in infos:
        pv = info.get("pv") or []
        if not pv:
            continue

        move = pv[0]
        score_cp = _score_to_centipawns(info["score"], board.turn)
        if best_score_cp is None:
            best_score_cp = score_cp

        candidates.append(
            {
                "uci": move.uci(),
                "san": board.san(move),
                "score_cp": score_cp,
                "score_loss_cp": (best_score_cp - score_cp) if best_score_cp is not None else None,
                "is_capture": board.is_capture(move),
                "is_check": board.gives_check(move),
                "is_promotion": move.promotion is not None,
            }
        )

    return candidates


def _extract_position_facts(board: chess.Board) -> dict:
    side_to_move = "white" if board.turn == chess.WHITE else "black"
    white_hanging = _find_hanging_pieces(board, chess.WHITE)
    black_hanging = _find_hanging_pieces(board, chess.BLACK)

    return {
        "side_to_move": side_to_move,
        "in_check": board.is_check(),
        "white_hanging_pieces": white_hanging,
        "black_hanging_pieces": black_hanging,
        "white_hanging_count": len(white_hanging),
        "black_hanging_count": len(black_hanging),
    }


def _build_position_profile(board: chess.Board, approved_moves: list[str]) -> dict:
    phase = _detect_phase(board)
    material = _material_profile(board)
    development = _development_profile(board)
    king_safety = _king_safety_profile(board)
    pawn_structure = _pawn_structure_profile(board)
    tactical = _tactical_profile(board)

    return {
        "phase": phase,
        "material": material,
        "development": development,
        "king_safety": king_safety,
        "pawn_structure": pawn_structure,
        "tactical": tactical,
        "plan_hints": _plan_hints(
            board=board,
            phase=phase,
            material=material,
            development=development,
            king_safety=king_safety,
            pawn_structure=pawn_structure,
            tactical=tactical,
            approved_moves=approved_moves,
        ),
    }


def _find_hanging_pieces(board: chess.Board, color: bool) -> list[str]:
    pieces = []

    for square, piece in board.piece_map().items():
        if piece.color != color or piece.piece_type == chess.KING:
            continue

        enemy_attackers = board.attackers(not color, square)
        own_defenders = board.attackers(color, square)
        if enemy_attackers and not own_defenders:
            pieces.append(f"{_piece_name(piece.piece_type)} on {chess.square_name(square)}")
        if len(pieces) >= _MAX_HANGING_PIECES:
            break

    return pieces


def _detect_phase(board: chess.Board) -> str:
    non_pawn_material = 0
    for piece in board.piece_map().values():
        if piece.piece_type in (chess.KING, chess.PAWN):
            continue
        non_pawn_material += _PIECE_VALUES[piece.piece_type]

    if non_pawn_material >= 6200:
        return "opening"
    if non_pawn_material >= 2600:
        return "middlegame"
    return "endgame"


def _material_profile(board: chess.Board) -> dict:
    white_counts = _piece_counts(board, chess.WHITE)
    black_counts = _piece_counts(board, chess.BLACK)

    white_score = sum(white_counts[piece] * value for piece, value in _PIECE_VALUES.items())
    black_score = sum(black_counts[piece] * value for piece, value in _PIECE_VALUES.items())

    return {
        "white": _counts_to_labels(white_counts),
        "black": _counts_to_labels(black_counts),
        "balance_cp_from_white": white_score - black_score,
    }


def _development_profile(board: chess.Board) -> dict:
    white_home = {"b1", "g1", "c1", "f1"}
    black_home = {"b8", "g8", "c8", "f8"}

    white_developed = _developed_minor_pieces(board, chess.WHITE, white_home)
    black_developed = _developed_minor_pieces(board, chess.BLACK, black_home)

    return {
        "white_minor_pieces_developed": white_developed,
        "black_minor_pieces_developed": black_developed,
        "white_likely_castled": _is_likely_castled(board, chess.WHITE),
        "black_likely_castled": _is_likely_castled(board, chess.BLACK),
    }


def _king_safety_profile(board: chess.Board) -> dict:
    return {
        "white": _single_king_safety(board, chess.WHITE),
        "black": _single_king_safety(board, chess.BLACK),
    }


def _pawn_structure_profile(board: chess.Board) -> dict:
    return {
        "white": _single_pawn_structure(board, chess.WHITE),
        "black": _single_pawn_structure(board, chess.BLACK),
    }


def _tactical_profile(board: chess.Board) -> dict:
    return {
        "white_pinned_pieces": _pinned_pieces(board, chess.WHITE),
        "black_pinned_pieces": _pinned_pieces(board, chess.BLACK),
        "white_hanging_pieces": _find_hanging_pieces(board, chess.WHITE),
        "black_hanging_pieces": _find_hanging_pieces(board, chess.BLACK),
    }


def _plan_hints(
    *,
    board: chess.Board,
    phase: str,
    material: dict,
    development: dict,
    king_safety: dict,
    pawn_structure: dict,
    tactical: dict,
    approved_moves: list[str],
) -> list[str]:
    color = board.turn
    side = "white" if color == chess.WHITE else "black"
    opponent = "black" if color == chess.WHITE else "white"
    hints: list[str] = []

    own_hanging = tactical[f"{side}_hanging_pieces"]
    opp_hanging = tactical[f"{opponent}_hanging_pieces"]
    own_pinned = tactical[f"{side}_pinned_pieces"]
    own_king = king_safety[side]
    opp_king = king_safety[opponent]
    own_pawns = pawn_structure[side]

    if board.is_check():
        hints.append("Resolve the check before thinking about a longer plan.")
    if own_hanging:
        hints.append("Stabilize your loose pieces before starting new operations.")
    if phase == "opening":
        own_dev = development[f"{side}_minor_pieces_developed"]
        opp_dev = development[f"{opponent}_minor_pieces_developed"]
        if own_dev < opp_dev or not own_king["likely_castled"]:
            hints.append("Catch up in development and secure your king.")
    if own_pinned:
        hints.append("Be careful with pinned pieces because they can limit your defensive resources.")
    if own_king["pawn_shield_count"] <= 1 and phase != "endgame":
        hints.append("Treat king safety as urgent before grabbing material.")
    if opp_hanging:
        hints.append("Pressure the opponent's loose pieces instead of drifting into a slow plan.")
    if own_pawns["passed_pawn_count"] > 0 and phase == "endgame":
        hints.append("Support your passed pawn and activate your king.")
    if opp_king["pawn_shield_count"] <= 1 and phase != "endgame":
        hints.append("Look for ways to increase pressure on the enemy king once your own position is stable.")
    if approved_moves:
        hints.append("If you need a concrete move, stay close to the engine-approved shortlist.")

    deduped = []
    for hint in hints:
        if hint not in deduped:
            deduped.append(hint)
        if len(deduped) >= 3:
            break

    if deduped:
        return deduped

    return ["Improve your least active piece and keep your position coordinated."]


def _piece_counts(board: chess.Board, color: bool) -> dict:
    counts = {piece: 0 for piece in _PIECE_VALUES}
    for piece in board.piece_map().values():
        if piece.color == color and piece.piece_type in counts:
            counts[piece.piece_type] += 1
    return counts


def _counts_to_labels(counts: dict) -> dict:
    return {
        "pawns": counts[chess.PAWN],
        "knights": counts[chess.KNIGHT],
        "bishops": counts[chess.BISHOP],
        "rooks": counts[chess.ROOK],
        "queens": counts[chess.QUEEN],
    }


def _developed_minor_pieces(board: chess.Board, color: bool, home_squares: set[str]) -> int:
    developed = 0
    for square, piece in board.piece_map().items():
        if piece.color != color or piece.piece_type not in (chess.KNIGHT, chess.BISHOP):
            continue
        if chess.square_name(square) not in home_squares:
            developed += 1
    return developed


def _is_likely_castled(board: chess.Board, color: bool) -> bool:
    king_square = board.king(color)
    if king_square is None:
        return False
    return chess.square_name(king_square) in {"g1", "c1", "g8", "c8"}


def _single_king_safety(board: chess.Board, color: bool) -> dict:
    king_square = board.king(color)
    if king_square is None:
        return {
            "square": "",
            "likely_castled": False,
            "pawn_shield_count": 0,
            "on_open_file": False,
        }

    file_index = chess.square_file(king_square)
    rank_index = chess.square_rank(king_square)
    direction = 1 if color == chess.WHITE else -1
    shield_count = 0

    for file_offset in (-1, 0, 1):
        next_file = file_index + file_offset
        next_rank = rank_index + direction
        if 0 <= next_file < 8 and 0 <= next_rank < 8:
            square = chess.square(next_file, next_rank)
            piece = board.piece_at(square)
            if piece and piece.color == color and piece.piece_type == chess.PAWN:
                shield_count += 1

    open_file = not any(
        piece.color == color and piece.piece_type == chess.PAWN and chess.square_file(square) == file_index
        for square, piece in board.piece_map().items()
    )

    return {
        "square": chess.square_name(king_square),
        "likely_castled": _is_likely_castled(board, color),
        "pawn_shield_count": shield_count,
        "on_open_file": open_file,
    }


def _single_pawn_structure(board: chess.Board, color: bool) -> dict:
    pawns_by_file = {file_index: [] for file_index in range(8)}
    for square, piece in board.piece_map().items():
        if piece.color == color and piece.piece_type == chess.PAWN:
            pawns_by_file[chess.square_file(square)].append(square)

    doubled = sum(max(0, len(squares) - 1) for squares in pawns_by_file.values())
    isolated = 0
    passed = 0

    for file_index, squares in pawns_by_file.items():
        if not squares:
            continue

        left_has_pawn = bool(pawns_by_file.get(file_index - 1, []))
        right_has_pawn = bool(pawns_by_file.get(file_index + 1, []))
        if not left_has_pawn and not right_has_pawn:
            isolated += len(squares)

        for square in squares:
            if _is_passed_pawn(board, color, square):
                passed += 1

    return {
        "doubled_pawn_count": doubled,
        "isolated_pawn_count": isolated,
        "passed_pawn_count": passed,
    }


def _is_passed_pawn(board: chess.Board, color: bool, square: chess.Square) -> bool:
    file_index = chess.square_file(square)
    rank_index = chess.square_rank(square)
    enemy_color = not color

    for enemy_square, piece in board.piece_map().items():
        if piece.color != enemy_color or piece.piece_type != chess.PAWN:
            continue
        enemy_file = chess.square_file(enemy_square)
        enemy_rank = chess.square_rank(enemy_square)
        if abs(enemy_file - file_index) > 1:
            continue
        if color == chess.WHITE and enemy_rank > rank_index:
            return False
        if color == chess.BLACK and enemy_rank < rank_index:
            return False
    return True


def _pinned_pieces(board: chess.Board, color: bool) -> list[str]:
    pinned = []
    for square, piece in board.piece_map().items():
        if piece.color != color or piece.piece_type == chess.KING:
            continue
        if board.is_pinned(color, square):
            pinned.append(f"{_piece_name(piece.piece_type)} on {chess.square_name(square)}")
    return pinned[:_MAX_HANGING_PIECES]


def _piece_name(piece_type: int) -> str:
    names = {
        chess.PAWN: "pawn",
        chess.KNIGHT: "knight",
        chess.BISHOP: "bishop",
        chess.ROOK: "rook",
        chess.QUEEN: "queen",
        chess.KING: "king",
    }
    return names.get(piece_type, "piece")


def _score_to_centipawns(score: chess.engine.PovScore, pov_color: bool) -> int:
    return score.pov(pov_color).score(mate_score=10000)
