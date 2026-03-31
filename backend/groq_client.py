import os
import time
import chess
from pathlib import Path
from groq import Groq

_PROMPTS_DIR = Path(__file__).parent / "prompts"
_client: Groq | None = None
MODEL = "openai/gpt-oss-120b"


def _get_client() -> Groq:
    global _client
    if _client is None:
        api_key = os.environ.get("GROQ_API_KEY")
        if not api_key:
            raise RuntimeError("GROQ_API_KEY non impostata nelle variabili d'ambiente")
        _client = Groq(api_key=api_key)
    return _client


def _load_prompt(filename: str) -> str:
    return (_PROMPTS_DIR / filename).read_text(encoding="utf-8")


def _uci_to_san(fen: str, uci: str) -> str:
    """Converte una mossa UCI in SAN dato il FEN della posizione. Fallback: stringa UCI originale."""
    try:
        board = chess.Board(fen)
        return board.san(chess.Move.from_uci(uci))
    except Exception:
        return uci


def get_coach_comment(
    fen: str,
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
        f"FEN position: {fen}\n"
        f"{mover_color}'s move: {player_move_san}\n"
        f"{responder_color}'s response: {engine_move or 'N/A'}\n"
        f"Engine evaluation: {score}\n"
        f"Engine best move: {best_move_san or 'N/A'}\n"
    )
    if move_log:
        user_message += f"Move history: {move_log}\n"

    for attempt in range(3):
        response = _get_client().chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            temperature=0.7,
            max_tokens=180,
        )
        result = response.choices[0].message.content
        if result and result.strip():
            return result.strip()
        if attempt < 2:
            time.sleep(0.5)

    raise RuntimeError("get_coach_comment: empty response after 3 attempts")


def get_hint_comment(fen: str, analysis: dict) -> str:
    """
    Suggerimento strategico senza rivelare la mossa esatta.
    """
    system_prompt = _load_prompt("hint_comment.txt")
    score = analysis.get("score", "N/A")

    user_message = (
        f"FEN position: {fen}\n"
        f"Engine evaluation: {score}\n"
    )

    for attempt in range(3):
        response = _get_client().chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            temperature=0.8,
            max_tokens=600,
        )
        result = response.choices[0].message.content
        if result and result.strip():
            return result.strip()
        if attempt < 2:
            time.sleep(0.5)

    raise RuntimeError("get_hint_comment: empty response after 3 attempts")
