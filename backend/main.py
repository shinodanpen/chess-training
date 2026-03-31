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
    analysis = stockfish_bridge.analyze_position(req.fen)

    # Applica la mossa del giocatore
    board.push(player_move)
    post_player_fen = board.fen()

    # Risposta dell'engine dalla posizione dopo la mossa del giocatore
    engine_move_uci = stockfish_bridge.get_best_move(post_player_fen, req.skill_level)

    # Converti la mossa engine in SAN (usando il FEN post-giocatore, dove la mossa engine è legale)
    engine_move_san = groq_client._uci_to_san(post_player_fen, engine_move_uci)

    # Commento del coach sull'intero turno (mossa giocatore + risposta engine)
    try:
        coach_comment = groq_client.get_coach_comment(
            fen=req.fen,
            player_move=req.move,
            analysis=analysis,
            engine_move=engine_move_san,
            player_color=req.player_color,
            move_log=req.move_log,
        )
    except RuntimeError as e:
        print(f"[WARN /move] get_coach_comment failed: {e}")
        coach_comment = "Could not retrieve coach comment. Check that the backend is running on localhost:8000."

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

    analysis = stockfish_bridge.get_hint(req.fen)
    hint = groq_client.get_hint_comment(fen=req.fen, analysis=analysis)

    if not hint:
        print("[WARN /hint] hint is empty or None")

    response_payload = {"hint": hint}
    print("[DEBUG /hint]", response_payload)

    return HintResponse(hint=hint)


@app.post("/chat", response_model=ChatResponse)
def post_chat(req: ChatRequest):
    try:
        reply = groq_client.get_chat_reply(
            fen=req.fen,
            move_log=req.move_log,
            coach_analysis=req.coach_analysis,
            chat_history=req.chat_history,
            message=req.message,
        )
    except RuntimeError as e:
        print(f"[WARN /chat] get_chat_reply failed: {e}")
        reply = "Could not reach the coach. Please try again."

    return ChatResponse(reply=reply)
