from dotenv import load_dotenv
load_dotenv()

import chess
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Any

import stockfish_bridge
import groq_client

app = FastAPI(title="Chess Training API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173", "http://localhost:5500"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Request / Response models ---

class MoveRequest(BaseModel):
    fen: str
    move: str
    skill_level: int = 10
    player_color: str = "white"
    move_log: str = ""


class MoveResponse(BaseModel):
    engine_move: str
    coach_comment: str
    score: int | str


class HintRequest(BaseModel):
    fen: str


class HintResponse(BaseModel):
    hint: str


class ChatRequest(BaseModel):
    fen: str
    move_log: str = ""
    coach_analysis: str = ""
    chat_history: List[Any] = []
    message: str


class ChatResponse(BaseModel):
    reply: str


class ScenarioValidateRequest(BaseModel):
    fen: str
    player_color: str = "white"
    opponent_elo: int = 1200


class ScenarioValidateResponse(BaseModel):
    normalized_fen: str
    skill_level: int
    opponent_to_move: bool


class ScenarioAnalyzeRequest(BaseModel):
    fen: str
    player_color: str = "white"


class ScenarioAnalyzeResponse(BaseModel):
    coach_comment: str
    score: int | str


class EngineMoveRequest(BaseModel):
    fen: str
    skill_level: int = 10


class EngineMoveResponse(BaseModel):
    engine_move: str


# --- Helpers ---

def _validate_player_color(player_color: str) -> str:
    if player_color not in {"white", "black"}:
        raise HTTPException(status_code=400, detail="player_color must be 'white' or 'black'")
    return player_color


def _elo_to_skill_level(opponent_elo: int) -> int:
    if opponent_elo < 800 or opponent_elo > 2200:
        raise HTTPException(status_code=400, detail="Opponent ELO must be between 800 and 2200")
    return max(0, min(20, round((opponent_elo - 800) / 70)))


# --- Endpoints ---

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/move", response_model=MoveResponse)
def post_move(req: MoveRequest):
    # Valida la posizione FEN
    try:
        board = chess.Board(req.fen)
    except ValueError:
        raise HTTPException(status_code=400, detail="FEN non valida")

    # Valida e applica la mossa del giocatore
    try:
        player_move = chess.Move.from_uci(req.move)
    except ValueError:
        raise HTTPException(status_code=400, detail="Formato mossa non valido (atteso UCI)")

    if player_move not in board.legal_moves:
        raise HTTPException(status_code=400, detail="Mossa illegale nella posizione corrente")

    # Analizza la posizione PRE-mossa: best_move = alternativa migliore (confronto con scelta giocatore)
    analysis = stockfish_bridge.analyze_position_rich(req.fen)

    # Applica la mossa del giocatore
    board.push(player_move)
    post_player_fen = board.fen()

    # Risposta dell'engine dalla posizione dopo la mossa del giocatore
    engine_move_uci = stockfish_bridge.get_best_move(post_player_fen, req.skill_level)

    # Converti la mossa engine in SAN (usando il FEN post-giocatore, dove la mossa engine è legale)
    engine_move_san = groq_client._uci_to_san(post_player_fen, engine_move_uci)
    final_board = chess.Board(post_player_fen)
    final_board.push(chess.Move.from_uci(engine_move_uci))
    final_fen = final_board.fen()

    # Commento del coach sull'intero turno (mossa giocatore + risposta engine)
    try:
        coach_comment = groq_client.get_coach_comment(
            fen=req.fen,
            final_fen=final_fen,
            player_move=req.move,
            analysis=analysis,
            engine_move=engine_move_san,
            player_color=req.player_color,
            move_log=req.move_log,
        )
    except Exception as e:
        print(f"[WARN /move] get_coach_comment failed: {e}")
        coach_comment = "Coach analysis unavailable for this move."

    if not coach_comment:
        print("[WARN /move] coach_comment is empty or None")

    return MoveResponse(
        engine_move=engine_move_uci,
        coach_comment=coach_comment,
        score=analysis["score"],
    )


@app.post("/hint", response_model=HintResponse)
def post_hint(req: HintRequest):
    try:
        chess.Board(req.fen)
    except ValueError:
        raise HTTPException(status_code=400, detail="FEN non valida")

    analysis = stockfish_bridge.analyze_position_rich(req.fen)
    hint = groq_client.get_hint_comment(fen=req.fen, analysis=analysis)

    if not hint:
        print("[WARN /hint] hint is empty or None")

    response_payload = {"hint": hint}
    print("[DEBUG /hint]", response_payload)

    return HintResponse(hint=hint)


@app.post("/chat", response_model=ChatResponse)
def post_chat(req: ChatRequest):
    try:
        board = chess.Board(req.fen)
    except ValueError:
        raise HTTPException(status_code=400, detail="FEN non valida")

    if not board.is_valid():
        raise HTTPException(status_code=400, detail="Position is not a valid legal chess position")

    try:
        reply = groq_client.get_chat_reply(
            fen=board.fen(),
            move_log=req.move_log,
            coach_analysis=req.coach_analysis,
            chat_history=req.chat_history,
            message=req.message,
        )
    except Exception as e:
        print(f"[WARN /chat] get_chat_reply failed: {e}")
        reply = "Could not reach the coach. Please try again."

    return ChatResponse(reply=reply)


@app.post("/scenario/validate", response_model=ScenarioValidateResponse)
def scenario_validate(req: ScenarioValidateRequest):
    player_color = _validate_player_color(req.player_color)

    try:
        board = chess.Board(req.fen)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid FEN")

    if not board.is_valid():
        raise HTTPException(status_code=400, detail="Scenario position is not a valid legal chess position")

    skill_level = _elo_to_skill_level(req.opponent_elo)
    player_turn = chess.WHITE if player_color == "white" else chess.BLACK

    return ScenarioValidateResponse(
        normalized_fen=board.fen(),
        skill_level=skill_level,
        opponent_to_move=board.turn != player_turn,
    )


@app.post("/scenario/analyze", response_model=ScenarioAnalyzeResponse)
def scenario_analyze(req: ScenarioAnalyzeRequest):
    _validate_player_color(req.player_color)

    try:
        board = chess.Board(req.fen)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid FEN")

    if not board.is_valid():
        raise HTTPException(status_code=400, detail="Scenario position is not a valid legal chess position")

    analysis = stockfish_bridge.analyze_position_rich(board.fen())

    try:
        coach_comment = groq_client.get_scenario_review(
            fen=board.fen(),
            analysis=analysis,
            player_color=req.player_color,
        )
    except Exception as e:
        print(f"[WARN /scenario/analyze] get_scenario_review failed: {e}")
        coach_comment = "This position deserves a careful review before you start playing from it."

    return ScenarioAnalyzeResponse(
        coach_comment=coach_comment,
        score=analysis["score"],
    )


@app.post("/engine-move", response_model=EngineMoveResponse)
def engine_move(req: EngineMoveRequest):
    try:
        board = chess.Board(req.fen)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid FEN")

    if not board.is_valid():
        raise HTTPException(status_code=400, detail="Position is not a valid legal chess position")

    if board.is_game_over():
        raise HTTPException(status_code=400, detail="No engine move is available because the game is already over")

    return EngineMoveResponse(
        engine_move=stockfish_bridge.get_best_move(board.fen(), req.skill_level)
    )
