import logging
import json
import os
import re
import time
import chess
from pathlib import Path
from groq import Groq
import stockfish_bridge

logger = logging.getLogger(__name__)

_PROMPTS_DIR = Path(__file__).parent / "prompts"
_client: Groq | None = None
MODEL = os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b")
_STRICT_STRUCTURED_OUTPUT_MODELS = {
    "openai/gpt-oss-20b",
    "openai/gpt-oss-120b",
}
_ADVICE_SAN_RE = re.compile(
    r"\b(?:play|try|consider|choose|prefer|go for|look at|use|recommend|suggest|answer with|meet with|you can play|you could play|you should play)\b"
    r"[^.!?\n]{0,40}\b(O-O-O|O-O|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?)\b",
    re.IGNORECASE,
)
_ADVICE_PIECE_TO_SQUARE_RE = re.compile(
    r"\b(?:move|bring|put|send|develop|reroute|lift|swing|place|get)\b"
    r"[^.!?\n]{0,35}\b(?:your|the)?\s*(king|queen|rook|bishop|knight|pawn)s?\b"
    r"[^.!?\n]{0,20}\b(?:to|onto|on)\s+([a-h][1-8])\b",
    re.IGNORECASE,
)
_ADVICE_CASTLE_RE = re.compile(
    r"\b(?:play|try|consider|choose|prefer|go for|recommend|suggest|you can|you could|you should)\b"
    r"[^.!?\n]{0,20}\bcastle\s+(kingside|queenside)\b",
    re.IGNORECASE,
)
_PIECE_NAME_TO_TYPE = {
    "king": chess.KING,
    "queen": chess.QUEEN,
    "rook": chess.ROOK,
    "bishop": chess.BISHOP,
    "knight": chess.KNIGHT,
    "pawn": chess.PAWN,
}


def _chat_completion_params(**kwargs):
    params = dict(kwargs)
    if MODEL.startswith("openai/gpt-oss-"):
        params.setdefault("include_reasoning", False)
        params.setdefault("reasoning_effort", os.environ.get("GROQ_REASONING_EFFORT", "low"))
    return params


def _supports_strict_structured_outputs(model: str | None = None) -> bool:
    return (model or MODEL) in _STRICT_STRUCTURED_OUTPUT_MODELS


def _get_client() -> Groq:
    global _client
    if _client is None:
        api_key = os.environ.get("GROQ_API_KEY")
        if not api_key:
            raise RuntimeError("GROQ_API_KEY non impostata nelle variabili d'ambiente")
        _client = Groq(api_key=api_key)
    return _client


def _truncate_to_sentences(text: str, max_sentences: int = 2) -> str:
    """Normalize output and enforce a hard sentence cap."""
    text = re.sub(r"\s+", " ", text.strip())
    text = re.sub(r"^[\-\*\d\.\)\s]+", "", text)

    if not text:
        return text

    parts = re.split(r"(?<=[.!?])\s+", text)
    cleaned = []

    for part in parts:
        part = part.strip(" \t\r\n-")
        if not part:
            continue
        if not re.search(r"[.!?]$", part):
            part = part.rstrip(" ,;:") + "."
        cleaned.append(part)
        if len(cleaned) >= max_sentences:
            break

    if not cleaned:
        fallback = text.rstrip(" ,;:")
        if fallback and not re.search(r"[.!?]$", fallback):
            fallback += "."
        return fallback[:240].strip()

    result = " ".join(cleaned)
    if len(result) > 240:
        result = result[:240].rsplit(" ", 1)[0].rstrip(" ,;:")
        if result and not re.search(r"[.!?]$", result):
            result += "."
    return result.strip()


def _normalize_single_sentence(text: str) -> str:
    text = (text or "").strip()
    if not text:
        return ""
    return _truncate_to_sentences(text, max_sentences=1)


def _structured_output_schema(schema_name: str, sentence_fields: int, include_move_fields: bool = False) -> dict:
    properties = {
        f"sentence_{index}": {
            "type": "string",
            "maxLength": 180,
        }
        for index in range(1, sentence_fields + 1)
    }
    required = list(properties.keys())

    if include_move_fields:
        properties["contains_concrete_move"] = {"type": "boolean"}
        properties["referenced_move_san"] = {"type": "string", "maxLength": 20}
        required.extend(["contains_concrete_move", "referenced_move_san"])
    else:
        properties["mentions_concrete_move"] = {"type": "boolean"}
        required.append("mentions_concrete_move")

    return {
        "type": "json_schema",
        "json_schema": {
            "name": schema_name,
            "strict": True,
            "schema": {
                "type": "object",
                "properties": properties,
                "required": required,
                "additionalProperties": False,
            },
        },
    }


def _parse_structured_json(content: str) -> dict | None:
    try:
        parsed = json.loads(content)
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None


def _render_structured_sentences(payload: dict, sentence_fields: int, max_sentences: int) -> str:
    parts = []
    for index in range(1, sentence_fields + 1):
        cleaned = _normalize_single_sentence(payload.get(f"sentence_{index}", ""))
        if cleaned:
            parts.append(cleaned)
        if len(parts) >= max_sentences:
            break
    return " ".join(parts).strip()


def _structured_text_completion(
    *,
    system_prompt: str,
    user_message: str,
    schema_name: str,
    sentence_fields: int,
    temperature: float,
    max_tokens: int,
    timeout: float,
    messages: list[dict] | None = None,
    include_move_fields: bool = False,
) -> tuple[str | None, dict | None, object | None]:
    request_messages = messages or [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_message},
    ]
    params = _chat_completion_params(
        model=MODEL,
        messages=request_messages,
        temperature=temperature,
        max_tokens=max_tokens,
        timeout=timeout,
    )
    if _supports_strict_structured_outputs():
        params["response_format"] = _structured_output_schema(
            schema_name=schema_name,
            sentence_fields=sentence_fields,
            include_move_fields=include_move_fields,
        )

    response = _get_client().chat.completions.create(**params)
    result = response.choices[0].message.content if response.choices else None
    payload = _parse_structured_json(result) if result and _supports_strict_structured_outputs() else None
    return result, payload, response


def _score_outlook(score: int | str) -> str:
    if isinstance(score, str):
        if score.startswith("mate"):
            try:
                mate_in = int(score.split()[1])
            except Exception:
                return "the position is tactically sharp"
            if mate_in == 0:
                return "the position is already decisive"
            if mate_in > 0:
                return "there is a forcing attack in the position"
            return "you are defending a forcing attack"
        return "the position is dynamically balanced"

    if score >= 250:
        return "you keep a clear edge"
    if score >= 80:
        return "you keep a small edge"
    if score <= -250:
        return "you are under real pressure"
    if score <= -80:
        return "you are slightly worse and need accuracy"
    return "the position stays roughly balanced"


def _build_local_coach_fallback(
    fen: str,
    player_move: str,
    analysis: dict,
    engine_move: str = "",
    player_color: str = "white",
) -> str:
    """
    Deterministic 2-sentence fallback used when the LLM returns empty content.
    Keeps the UX usable without exposing raw engine numbers or best-move spoilers.
    """
    player_move_san = _uci_to_san(fen, player_move)
    score = analysis.get("score", "N/A")
    best_move_uci = analysis.get("best_move")
    matched_best = bool(best_move_uci and best_move_uci == player_move)
    opponent_color = "Black" if player_color == "white" else "White"
    outlook = _score_outlook(score)

    if matched_best:
        first = f"Your move {player_move_san} was a strong practical choice, and {opponent_color} answered with {engine_move or 'a solid reply'}."
    else:
        first = f"After {player_move_san}, {opponent_color} answered with {engine_move or 'a useful reply'}, so {outlook}."

    if isinstance(score, str) and score.startswith("mate"):
        second = "Treat this position concretely and watch for immediate tactical threats before making a strategic plan."
    elif isinstance(score, int) and score <= -80:
        second = "Focus on damage control here: improve king safety, complete development, and avoid creating new weaknesses."
    elif isinstance(score, int) and score >= 80:
        second = "You can play this position proactively now: improve your least active piece and keep the pressure coordinated."
    else:
        second = "The key now is piece activity and coordination, because a small inaccuracy could shift the balance quickly."

    return _truncate_to_sentences(f"{first} {second}", max_sentences=2)


def _build_local_scenario_fallback(fen: str, analysis: dict, player_color: str = "white") -> str:
    board = chess.Board(fen)
    side_to_move = "White" if board.turn == chess.WHITE else "Black"
    player_side = player_color.capitalize()
    score = analysis.get("score", "N/A")
    outlook = _score_outlook(score)

    first = f"This is a scenario for {player_side}, and {side_to_move} is the side to move."
    if isinstance(score, str) and score.startswith("mate"):
        second = "The position is tactically critical, so calculate forcing lines before you think about longer plans."
    elif isinstance(score, int) and score <= -80:
        second = f"Right now {outlook}, so focus on king safety and your least active piece first."
    elif isinstance(score, int) and score >= 80:
        second = f"Right now {outlook}, so look for a clean way to improve activity without giving up coordination."
    else:
        second = f"Right now {outlook}, and piece coordination matters more than rushing into a premature plan."

    return _truncate_to_sentences(f"{first} {second}", max_sentences=2)


def _build_local_chat_fallback(fen: str, message: str) -> str:
    board = chess.Board(fen)
    side_to_move = "White" if board.turn == chess.WHITE else "Black"

    if board.is_game_over():
        return "This position is already game over, so there is no legal continuation to recommend."

    if board.is_check():
        return f"{side_to_move} is in check here, so the first job is to solve that threat with a legal move rather than force a plan."

    first = f"{side_to_move} is to move here, so stay grounded in legal options from the current position."
    second = "Focus on king safety, loose pieces, and your least active piece before committing to a concrete line."
    return _truncate_to_sentences(f"{first} {second}", max_sentences=2)


def _load_prompt(filename: str) -> str:
    return (_PROMPTS_DIR / filename).read_text(encoding="utf-8")


def _board_snapshot(fen: str) -> str:
    board = chess.Board(fen)
    groups = {
        "White": {"K": [], "Q": [], "R": [], "B": [], "N": [], "P": []},
        "Black": {"K": [], "Q": [], "R": [], "B": [], "N": [], "P": []},
    }

    for square, piece in sorted(board.piece_map().items()):
        color_key = "White" if piece.color == chess.WHITE else "Black"
        groups[color_key][piece.symbol().upper()].append(chess.square_name(square))

    labels = {
        "K": "King",
        "Q": "Queen",
        "R": "Rooks",
        "B": "Bishops",
        "N": "Knights",
        "P": "Pawns",
    }

    lines = []
    for color_key in ("White", "Black"):
        parts = []
        for piece_code in ("K", "Q", "R", "B", "N", "P"):
            squares = groups[color_key][piece_code]
            if squares:
                parts.append(f"{labels[piece_code]}: {', '.join(squares)}")
        lines.append(f"{color_key} pieces -> " + ("; ".join(parts) if parts else "none"))

    return "\n".join(lines)


def _uci_to_san(fen: str, uci: str) -> str:
    """Converte una mossa UCI in SAN dato il FEN della posizione. Fallback: stringa UCI originale."""
    try:
        board = chess.Board(fen)
        return board.san(chess.Move.from_uci(uci))
    except Exception:
        return uci


def _legal_san_moves(fen: str) -> list[str]:
    board = chess.Board(fen)
    return sorted(board.san(move) for move in board.legal_moves)


def _legal_moves_context(fen: str) -> str:
    board = chess.Board(fen)
    side_to_move = "White" if board.turn == chess.WHITE else "Black"
    legal_moves = _legal_san_moves(fen)

    if not legal_moves:
        return f"Legal moves for {side_to_move}: none (game over)."

    return f"Legal moves for {side_to_move} from this position (SAN): {', '.join(legal_moves)}"


def _analysis_grounding_context(analysis: dict) -> str:
    if not analysis:
        return ""

    parts = []
    candidates = analysis.get("candidates") or []
    approved_moves = analysis.get("approved_moves") or []
    facts = analysis.get("facts") or {}
    profile = analysis.get("position_profile") or {}

    if candidates:
        formatted = []
        for candidate in candidates[:3]:
            score_loss = candidate.get("score_loss_cp")
            score_loss_text = f", score_loss={score_loss}cp" if score_loss is not None else ""
            tags = []
            if candidate.get("is_check"):
                tags.append("check")
            if candidate.get("is_capture"):
                tags.append("capture")
            if candidate.get("is_promotion"):
                tags.append("promotion")
            tag_text = f", tags={','.join(tags)}" if tags else ""
            formatted.append(f"{candidate['san']} ({candidate['uci']}{score_loss_text}{tag_text})")
        parts.append("Engine candidate moves: " + "; ".join(formatted))

    if approved_moves:
        parts.append("Engine-approved concrete moves for chat: " + ", ".join(approved_moves))

    if facts:
        parts.append(f"Side to move: {facts.get('side_to_move', 'unknown')}")
        if facts.get("in_check"):
            parts.append("The side to move is currently in check.")
        white_hanging = facts.get("white_hanging_pieces") or []
        black_hanging = facts.get("black_hanging_pieces") or []
        if white_hanging:
            parts.append("White hanging pieces: " + ", ".join(white_hanging))
        if black_hanging:
            parts.append("Black hanging pieces: " + ", ".join(black_hanging))

    if profile:
        parts.extend(_position_profile_lines(profile))

    return "\n".join(parts)


def _position_profile_lines(profile: dict) -> list[str]:
    lines = []
    phase = profile.get("phase")
    material = profile.get("material") or {}
    development = profile.get("development") or {}
    king_safety = profile.get("king_safety") or {}
    pawn_structure = profile.get("pawn_structure") or {}
    tactical = profile.get("tactical") or {}
    plan_hints = profile.get("plan_hints") or []

    if phase:
        lines.append(f"Game phase: {phase}.")

    material_balance = material.get("balance_cp_from_white")
    if material_balance is not None:
        lines.append(f"Material balance from White's perspective: {material_balance} cp.")

    if development:
        lines.append(
            "Development: "
            f"White developed minors={development.get('white_minor_pieces_developed', 0)}, "
            f"Black developed minors={development.get('black_minor_pieces_developed', 0)}, "
            f"White castled={development.get('white_likely_castled', False)}, "
            f"Black castled={development.get('black_likely_castled', False)}."
        )

    if king_safety:
        white = king_safety.get("white") or {}
        black = king_safety.get("black") or {}
        lines.append(
            "King safety: "
            f"White king={white.get('square', '?')}, shield={white.get('pawn_shield_count', 0)}, open_file={white.get('on_open_file', False)}; "
            f"Black king={black.get('square', '?')}, shield={black.get('pawn_shield_count', 0)}, open_file={black.get('on_open_file', False)}."
        )

    if pawn_structure:
        white = pawn_structure.get("white") or {}
        black = pawn_structure.get("black") or {}
        lines.append(
            "Pawn structure: "
            f"White doubled={white.get('doubled_pawn_count', 0)}, isolated={white.get('isolated_pawn_count', 0)}, passed={white.get('passed_pawn_count', 0)}; "
            f"Black doubled={black.get('doubled_pawn_count', 0)}, isolated={black.get('isolated_pawn_count', 0)}, passed={black.get('passed_pawn_count', 0)}."
        )

    if tactical:
        if tactical.get("white_pinned_pieces"):
            lines.append("White pinned pieces: " + ", ".join(tactical["white_pinned_pieces"]))
        if tactical.get("black_pinned_pieces"):
            lines.append("Black pinned pieces: " + ", ".join(tactical["black_pinned_pieces"]))

    if plan_hints:
        lines.append("Deterministic plan hints: " + " | ".join(plan_hints[:3]))

    return lines


def _contains_concrete_move_advice(text: str) -> bool:
    return bool(
        _ADVICE_SAN_RE.search(text)
        or _ADVICE_PIECE_TO_SQUARE_RE.search(text)
        or _ADVICE_CASTLE_RE.search(text)
    )


def _piece_can_legally_reach_square(board: chess.Board, piece_name: str, target_square_name: str) -> bool:
    piece_type = _PIECE_NAME_TO_TYPE.get(piece_name.lower().rstrip("s"))
    if piece_type is None:
        return False

    target_square = chess.parse_square(target_square_name)
    for move in board.legal_moves:
        piece = board.piece_at(move.from_square)
        if (
            piece
            and piece.color == board.turn
            and piece.piece_type == piece_type
            and move.to_square == target_square
        ):
            return True
    return False


def _move_advice_is_legal(fen: str, text: str) -> bool:
    board = chess.Board(fen)

    for san in _ADVICE_SAN_RE.findall(text):
        try:
            board.parse_san(san)
        except ValueError:
            return False

    for castle_side in _ADVICE_CASTLE_RE.findall(text):
        san = "O-O" if castle_side.lower() == "kingside" else "O-O-O"
        try:
            board.parse_san(san)
        except ValueError:
            return False

    for piece_name, target_square in _ADVICE_PIECE_TO_SQUARE_RE.findall(text):
        if not _piece_can_legally_reach_square(board, piece_name, target_square):
            return False

    return True


def _extract_first_san_from_text(text: str) -> str:
    match = _ADVICE_SAN_RE.search(text or "")
    return match.group(1) if match else ""


def _canonicalize_san(fen: str, san: str) -> str:
    try:
        board = chess.Board(fen)
        move = board.parse_san(san)
        return board.san(move)
    except ValueError:
        return ""


def _chat_move_advice_is_sane(fen: str, san: str, approved_moves: list[str] | None = None) -> bool:
    canonical_san = _canonicalize_san(fen, san)
    if not canonical_san:
        return False

    if approved_moves and canonical_san not in approved_moves:
        logger.warning("Rejected chat move %s because it is outside the approved engine shortlist %s", canonical_san, approved_moves)
        return False

    try:
        result = stockfish_bridge.is_chat_move_sane(fen, canonical_san)
    except Exception as exc:
        logger.warning("chat move sanity check failed for %s: %s", canonical_san, exc, exc_info=True)
        return False

    if not result.get("legal"):
        return False
    if not result.get("sane"):
        logger.warning(
            "Rejected chat move %s as tactically unsound | score_loss_cp=%s | best_move=%s",
            canonical_san,
            result.get("score_loss_cp"),
            result.get("best_move"),
        )
        return False
    return True


def get_coach_comment(
    fen: str,
    final_fen: str,
    player_move: str,
    analysis: dict,
    engine_move: str = "",
    player_color: str = "white",
    move_log: str = "",
) -> str:
    """
    Commento del coach sull'intero turno (mossa giocatore + risposta engine).
    analysis deve contenere almeno 'score' e 'best_move'.
    engine_move deve essere già in SAN.
    Le mosse vengono convertite in SAN prima di essere passate al prompt.
    Riprova fino a 3 volte se la risposta è vuota.
    """
    system_prompt = _load_prompt("coach_comment.txt")
    score = analysis.get("score", "N/A")
    best_move_uci = analysis.get("best_move")

    # Converti player_move UCI -> SAN (usando il FEN pre-mossa)
    player_move_san = _uci_to_san(fen, player_move)

    # Converti best_move UCI -> SAN (usando il FEN pre-mossa, dove best_move si applica)
    best_move_san = _uci_to_san(fen, best_move_uci) if best_move_uci else None

    # Determina i colori dal FEN pre-mossa
    board = chess.Board(fen)
    mover_color = "White" if board.turn == chess.WHITE else "Black"
    responder_color = "Black" if board.turn == chess.WHITE else "White"

    # Contesto identità giocatore
    opponent_color = "Black" if player_color == "white" else "White"
    player_context = f"The player is {player_color.capitalize()}. The opponent is {opponent_color}."

    user_message = (
        f"{player_context}\n"
        f"Pre-move FEN position: {fen}\n"
        f"Pre-move board snapshot:\n{_board_snapshot(fen)}\n"
        f"{_analysis_grounding_context(analysis)}\n"
        f"{mover_color}'s move: {player_move_san}\n"
        f"{responder_color}'s response: {engine_move or 'N/A'}\n"
        f"Final FEN after the full turn: {final_fen}\n"
        f"Final board snapshot:\n{_board_snapshot(final_fen)}\n"
        f"{_legal_moves_context(final_fen)}\n"
        f"Engine evaluation: {score}\n"
        f"Engine best move: {best_move_san or 'N/A'}\n"
        "Return JSON matching the provided schema.\n"
        "Put at most one short sentence in sentence_1 and at most one short sentence in sentence_2.\n"
        "Use an empty string for sentence_2 if one sentence is enough.\n"
        "Set mentions_concrete_move to true only if you explicitly name a concrete move or destination square.\n"
    )
    if move_log:
        user_message += f"Move history: {move_log}\n"

    for attempt in range(3):
        try:
            result, payload, response = _structured_text_completion(
                system_prompt=system_prompt,
                user_message=user_message,
                schema_name="coach_comment",
                sentence_fields=2,
                temperature=0.25,
                max_tokens=220,
                timeout=60.0,
            )
            finish_reason = response.choices[0].finish_reason if response.choices else None
            usage = response.usage
            if payload:
                cleaned = _render_structured_sentences(payload, sentence_fields=2, max_sentences=2)
                if cleaned and not payload.get("mentions_concrete_move") and not _contains_concrete_move_advice(cleaned):
                    return cleaned
                logger.warning("get_coach_comment attempt %d: rejected structured concrete move advice: %s", attempt + 1, payload)
            elif result and result.strip():
                cleaned = _truncate_to_sentences(result.strip(), max_sentences=2)
                if not _contains_concrete_move_advice(cleaned):
                    return cleaned
                logger.warning("get_coach_comment attempt %d: rejected concrete move advice: %s", attempt + 1, cleaned)
            logger.warning(
                "get_coach_comment attempt %d: empty content | finish_reason=%s | "
                "prompt_tokens=%s | completion_tokens=%s | model=%s",
                attempt + 1, finish_reason,
                getattr(usage, "prompt_tokens", None),
                getattr(usage, "completion_tokens", None),
                getattr(response, "model", MODEL),
            )
        except Exception as e:
            logger.warning("get_coach_comment attempt %d exception: %s", attempt + 1, e, exc_info=True)
        if attempt < 2:
            time.sleep(1.5)

    logger.warning("get_coach_comment: all %d attempts failed, using local fallback", 3)
    return _build_local_coach_fallback(
        fen=fen,
        player_move=player_move,
        analysis=analysis,
        engine_move=engine_move,
        player_color=player_color,
    )


def get_chat_reply(
    fen: str,
    move_log: str,
    coach_analysis: str,
    chat_history: list,
    message: str,
) -> str:
    """
    Risposta del coach a una domanda libera del giocatore.
    chat_history: lista di {role: 'user'|'coach', text: str} scambi precedenti.
    Il contesto (FEN, move_log, coach_analysis) viene iniettato nel messaggio corrente.
    Riprova fino a 3 volte se la risposta è vuota.
    """
    system_prompt = _load_prompt("chat_reply.txt")
    rich_analysis = stockfish_bridge.analyze_position_rich(fen)
    approved_moves = rich_analysis.get("approved_moves") or []

    messages = [{"role": "system", "content": system_prompt}]

    # Append previous exchanges
    role_map = {"user": "user", "coach": "assistant"}
    for entry in chat_history:
        role = role_map.get(entry.get("role", "user"), "user")
        messages.append({"role": role, "content": entry.get("text", "")})

    # Current message with context injected
    context_parts = [f"FEN position: {fen}", f"Board snapshot:\n{_board_snapshot(fen)}"]
    context_parts.append(_legal_moves_context(fen))
    grounding_context = _analysis_grounding_context(rich_analysis)
    if grounding_context:
        context_parts.append(grounding_context)
    if move_log:
        context_parts.append(f"Move history: {move_log}")
    if coach_analysis:
        context_parts.append(f"Coach analysis of last turn: {coach_analysis}")
    context_block = "\n".join(context_parts)
    user_message = (
        f"{context_block}\n\n"
        f"Player: {message}\n"
        "Return JSON matching the provided schema.\n"
        "Put at most one sentence in each of sentence_1, sentence_2, and sentence_3.\n"
        "Use empty strings for any unused sentence fields.\n"
        "If you mention a concrete move, set contains_concrete_move to true and set referenced_move_san to that SAN move exactly.\n"
        "If you do not mention a concrete move, set contains_concrete_move to false and referenced_move_san to an empty string.\n"
    )
    messages.append({"role": "user", "content": user_message})

    for attempt in range(3):
        try:
            result, payload, response = _structured_text_completion(
                system_prompt=system_prompt,
                user_message=user_message,
                schema_name="chat_reply",
                sentence_fields=3,
                include_move_fields=True,
                messages=messages,
                temperature=0.7,
                max_tokens=300,
                timeout=60.0,
            )
            finish_reason = response.choices[0].finish_reason if response.choices else None
            usage = response.usage
            if payload:
                cleaned = _render_structured_sentences(payload, sentence_fields=3, max_sentences=3)
                if not cleaned:
                    logger.warning("get_chat_reply attempt %d: empty structured payload", attempt + 1)
                else:
                    referenced_move_san = (payload.get("referenced_move_san") or "").strip()
                    if payload.get("contains_concrete_move") and not referenced_move_san:
                        logger.warning("get_chat_reply attempt %d: missing SAN for structured move advice: %s", attempt + 1, payload)
                    else:
                        if referenced_move_san:
                            if not _chat_move_advice_is_sane(fen, referenced_move_san, approved_moves=approved_moves):
                                logger.warning("get_chat_reply attempt %d: rejected structured SAN after engine sanity check: %s", attempt + 1, referenced_move_san)
                                referenced_move_san = ""
                        if (
                            (not payload.get("contains_concrete_move") or referenced_move_san)
                            and (not _contains_concrete_move_advice(cleaned) or _move_advice_is_legal(fen, cleaned))
                        ):
                            return cleaned
                        logger.warning("get_chat_reply attempt %d: rejected unsafe structured move advice: %s", attempt + 1, payload)
            elif result and result.strip():
                cleaned = result.strip()
                if not _contains_concrete_move_advice(cleaned):
                    return cleaned
                suggested_san = _extract_first_san_from_text(cleaned)
                if (
                    _move_advice_is_legal(fen, cleaned)
                    and suggested_san
                    and _chat_move_advice_is_sane(fen, suggested_san, approved_moves=approved_moves)
                ):
                    return cleaned
                logger.warning("get_chat_reply attempt %d: rejected unsafe move advice: %s", attempt + 1, cleaned)
            logger.warning(
                "get_chat_reply attempt %d: empty content | finish_reason=%s | "
                "prompt_tokens=%s | completion_tokens=%s",
                attempt + 1, finish_reason,
                getattr(usage, "prompt_tokens", None),
                getattr(usage, "completion_tokens", None),
            )
        except Exception as e:
            logger.warning("get_chat_reply attempt %d exception: %s", attempt + 1, e, exc_info=True)
        if attempt < 2:
            time.sleep(0.5)

    logger.warning("get_chat_reply: all attempts failed or were rejected, using local fallback")
    return _build_local_chat_fallback(fen=fen, message=message)


def get_hint_comment(fen: str, analysis: dict) -> str:
    """
    Suggerimento strategico senza rivelare la mossa esatta.
    """
    system_prompt = _load_prompt("hint_comment.txt")
    score = analysis.get("score", "N/A")

    user_message = (
        f"FEN position: {fen}\n"
        f"Board snapshot:\n{_board_snapshot(fen)}\n"
        f"{_legal_moves_context(fen)}\n"
        f"{_analysis_grounding_context(analysis)}\n"
        f"Engine evaluation: {score}\n"
        "Return JSON matching the provided schema.\n"
        "Put at most one short sentence in sentence_1 and at most one short sentence in sentence_2.\n"
        "Use an empty string for sentence_2 if one sentence is enough.\n"
        "Set mentions_concrete_move to true only if you explicitly name a concrete move or destination square.\n"
    )

    for attempt in range(3):
        try:
            result, payload, response = _structured_text_completion(
                system_prompt=system_prompt,
                user_message=user_message,
                schema_name="hint_comment",
                sentence_fields=2,
                temperature=0.45,
                max_tokens=600,
                timeout=60.0,
            )
            finish_reason = response.choices[0].finish_reason if response.choices else None
            usage = response.usage
            if payload:
                cleaned = _render_structured_sentences(payload, sentence_fields=2, max_sentences=2)
                if cleaned and not payload.get("mentions_concrete_move") and not _contains_concrete_move_advice(cleaned):
                    return cleaned
                logger.warning("get_hint_comment attempt %d: rejected structured concrete move advice: %s", attempt + 1, payload)
            elif result and result.strip():
                cleaned = _truncate_to_sentences(result.strip(), max_sentences=2)
                if not _contains_concrete_move_advice(cleaned):
                    return cleaned
                logger.warning("get_hint_comment attempt %d: rejected concrete move advice: %s", attempt + 1, cleaned)
            logger.warning(
                "get_hint_comment attempt %d: empty content | finish_reason=%s | "
                "prompt_tokens=%s | completion_tokens=%s",
                attempt + 1, finish_reason,
                getattr(usage, "prompt_tokens", None),
                getattr(usage, "completion_tokens", None),
            )
        except Exception as e:
            logger.warning("get_hint_comment attempt %d exception: %s", attempt + 1, e, exc_info=True)
        if attempt < 2:
            time.sleep(0.5)

    logger.warning("get_hint_comment: all attempts failed, using generic fallback")
    return "Look carefully at your least active piece and consider how to improve its scope."


def get_scenario_review(
    fen: str,
    analysis: dict,
    player_color: str = "white",
) -> str:
    """
    Position-only coach review for a validated scenario before play begins.
    """
    system_prompt = _load_prompt("scenario_review.txt")
    board = chess.Board(fen)
    side_to_move = "White" if board.turn == chess.WHITE else "Black"
    score = analysis.get("score", "N/A")

    user_message = (
        f"The player is {player_color.capitalize()}.\n"
        f"FEN position: {fen}\n"
        f"Board snapshot:\n{_board_snapshot(fen)}\n"
        f"{_legal_moves_context(fen)}\n"
        f"{_analysis_grounding_context(analysis)}\n"
        f"Side to move: {side_to_move}\n"
        f"Engine evaluation: {score}\n"
        "Return JSON matching the provided schema.\n"
        "Put at most one short sentence in sentence_1 and at most one short sentence in sentence_2.\n"
        "Use an empty string for sentence_2 if one sentence is enough.\n"
        "Set mentions_concrete_move to true only if you explicitly name a concrete move or destination square.\n"
    )

    for attempt in range(3):
        try:
            result, payload, response = _structured_text_completion(
                system_prompt=system_prompt,
                user_message=user_message,
                schema_name="scenario_review",
                sentence_fields=2,
                temperature=0.4,
                max_tokens=220,
                timeout=60.0,
            )
            finish_reason = response.choices[0].finish_reason if response.choices else None
            usage = response.usage
            if payload:
                cleaned = _render_structured_sentences(payload, sentence_fields=2, max_sentences=2)
                if cleaned and not payload.get("mentions_concrete_move") and not _contains_concrete_move_advice(cleaned):
                    return cleaned
                logger.warning("get_scenario_review attempt %d: rejected structured concrete move advice: %s", attempt + 1, payload)
            elif result and result.strip():
                cleaned = _truncate_to_sentences(result.strip(), max_sentences=2)
                if not _contains_concrete_move_advice(cleaned):
                    return cleaned
                logger.warning("get_scenario_review attempt %d: rejected concrete move advice: %s", attempt + 1, cleaned)
            logger.warning(
                "get_scenario_review attempt %d: empty content | finish_reason=%s | "
                "prompt_tokens=%s | completion_tokens=%s",
                attempt + 1, finish_reason,
                getattr(usage, "prompt_tokens", None),
                getattr(usage, "completion_tokens", None),
            )
        except Exception as e:
            logger.warning("get_scenario_review attempt %d exception: %s", attempt + 1, e, exc_info=True)
        if attempt < 2:
            time.sleep(0.5)

    logger.warning("get_scenario_review: all %d attempts failed, using local fallback", 3)
    return _build_local_scenario_fallback(
        fen=fen,
        analysis=analysis,
        player_color=player_color,
    )
