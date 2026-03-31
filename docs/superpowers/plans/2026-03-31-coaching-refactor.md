# Coaching System Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the chat panel into a persistent analysis zone and a scrollable chat zone, activate free-form chat via a new `POST /chat` endpoint, and tighten post-move analysis to 2 sentences.

**Architecture:** `.chat-section` becomes a flex column with two children: `.analysis-zone` (`flex: 0 0 auto`, content replaced on every turn) and `.chat-zone` (`flex: 1`, scrollable, cleared on every turn). `syncLayout()` is updated to measure `analysisZone.offsetHeight` when computing chat-zone height. A new `POST /chat` endpoint accepts FEN, move log, prior analysis, conversation history, and player message; responds via Groq with a coach reply. Frontend tracks `currentCoachAnalysis` and `currentTurnChatHistory` (both reset on new analysis and on undo).

**Tech Stack:** FastAPI, Python 3.11+, Groq SDK (synchronous), vanilla HTML/CSS/JS, chessboard.js 1.0, chess.js 0.10.3

---

## File Map

| File | Action | What changes |
|---|---|---|
| `backend/prompts/coach_comment.txt` | Modify | Add 2-sentence + no-follow-up constraints |
| `backend/prompts/chat_reply.txt` | Create | New system prompt for free-form chat |
| `backend/groq_client.py` | Modify | Update `get_coach_comment` (remove `context`, add `move_log`, lower `max_tokens`); add `get_chat_reply()` |
| `backend/main.py` | Modify | Add `move_log` to `MoveRequest`; add `ChatRequest` model and `POST /chat` endpoint |
| `frontend/index.html` | Modify | Replace `#chat-messages` with `#analysis-zone` + `#chat-zone`; enable chat input |
| `frontend/style.css` | Modify | Replace `.chat-messages` with `.analysis-zone` + `.chat-zone` + `.analysis-placeholder` styles |
| `frontend/app.js` | Modify | New state vars; `resetChatState()`; update `addMessage()`, `addCoachMessage()`, `syncLayout()`, `executeMove()`, `undoLastTurn()`, `startGame()`, `startSetup()`; new `btn-send` handler |
| `CLAUDE.md` | Modify | Document new architecture |

---

## Task 1: Tighten `coach_comment.txt` prompt

**Files:**
- Modify: `backend/prompts/coach_comment.txt`

- [ ] **Step 1: Add 2-sentence and no-follow-up constraints**

Open `backend/prompts/coach_comment.txt` and prepend these two rules at the top of the Rules list (before the existing first bullet):

```
- Maximum 2 sentences. No more.
- This is a brief analysis, not a conversation — do not invite follow-up, do not ask questions.
```

Full updated file:

```
You are a chess coach. Comment on the full turn just played: the player's move and the opponent's response.

The user message tells you which color the player is and which color the opponent is.

Rules:
- Maximum 2 sentences. No more.
- This is a brief analysis, not a conversation — do not invite follow-up, do not ask questions.
- Refer to the player as "you" / "your move". Refer to the opponent by their color (e.g. "White" or "Black").
- Comment on the turn as a unit: what happened with your move, how the opponent responded, and what it means for the position.
- When the player's move was a mistake, name the concept it violated — concisely and plainly (e.g. "this cedes center control", "this leaves your king exposed", "this knight now has no safe square", "this allows a discovered attack on your rook").
- When the player's move was strong, acknowledge it in one short clause, then focus on what comes next.
- When relevant, suggest a concrete strategic idea or plan for the next few moves (e.g. "consider activating your rook on the d-file", "look for a way to challenge that knight").
- Explain *why* something matters in this specific position — not just what happened, but why it's significant.
- Be direct, calm, and plain-spoken — like a knowledgeable friend. Not a cheerleader, not a lecturer.
- Never reveal the numerical evaluation in centipawns.
- Never name the exact best move.
- Never use hollow filler: "good move!", "well done!", "nice choice!", "great job!", "Absolutely!", "Sure!".

The user message contains: player identity context, FEN, your move in SAN with color label, opponent's response in SAN with color label, engine evaluation, engine best move in SAN, move history.
```

- [ ] **Step 2: Commit**

```bash
cd backend
git add prompts/coach_comment.txt
git commit -m "feat: tighten coach_comment prompt to 2 sentences, no follow-up"
```

---

## Task 2: Update `get_coach_comment()` in `groq_client.py`

**Files:**
- Modify: `backend/groq_client.py`

- [ ] **Step 1: Update signature — remove `context`, add `move_log`, lower `max_tokens`**

Replace the entire `get_coach_comment` function. The changes are:
- Remove `context: str = ""` parameter
- Add `move_log: str = ""` parameter
- Replace the `if context:` block with a `if move_log:` block
- Lower `max_tokens` from 600 to 180

```python
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
```

- [ ] **Step 2: Commit**

```bash
git add backend/groq_client.py
git commit -m "feat: add move_log to get_coach_comment, lower max_tokens to 180"
```

---

## Task 3: Create `chat_reply.txt` and add `get_chat_reply()` to `groq_client.py`

**Files:**
- Create: `backend/prompts/chat_reply.txt`
- Modify: `backend/groq_client.py`

- [ ] **Step 1: Create `chat_reply.txt`**

```
You are a chess coach in an ongoing conversation with the player.
You have already analyzed the last turn — the analysis is provided as context in each message.
Answer the player's question naturally, using the position and move history as context.
Be concrete and specific — refer to actual pieces and squares when relevant.
Never reveal centipawn scores.
Max 3 sentences unless a longer answer is clearly needed.
No filler: never start with "Sure!", "Absolutely!", "Of course!".
```

Save to `backend/prompts/chat_reply.txt`.

- [ ] **Step 2: Add `get_chat_reply()` to `groq_client.py`**

Add this function after `get_hint_comment`:

```python
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

    messages = [{"role": "system", "content": system_prompt}]

    # Append previous exchanges
    role_map = {"user": "user", "coach": "assistant"}
    for entry in chat_history:
        role = role_map.get(entry.get("role", "user"), "user")
        messages.append({"role": role, "content": entry.get("text", "")})

    # Current message with context injected
    context_parts = [f"FEN position: {fen}"]
    if move_log:
        context_parts.append(f"Move history: {move_log}")
    if coach_analysis:
        context_parts.append(f"Coach analysis of last turn: {coach_analysis}")
    context_block = "\n".join(context_parts)
    user_message = f"{context_block}\n\nPlayer: {message}"
    messages.append({"role": "user", "content": user_message})

    for attempt in range(3):
        response = _get_client().chat.completions.create(
            model=MODEL,
            messages=messages,
            temperature=0.7,
            max_tokens=300,
        )
        result = response.choices[0].message.content
        if result and result.strip():
            return result.strip()
        if attempt < 2:
            time.sleep(0.5)

    raise RuntimeError("get_chat_reply: empty response after 3 attempts")
```

- [ ] **Step 3: Commit**

```bash
git add backend/prompts/chat_reply.txt backend/groq_client.py
git commit -m "feat: add get_chat_reply and chat_reply.txt system prompt"
```

---

## Task 4: Update `main.py` — `MoveRequest`, `ChatRequest`, `POST /chat`

**Files:**
- Modify: `backend/main.py`

- [ ] **Step 1: Add `move_log` to `MoveRequest`, add `ChatRequest`, add `/chat` endpoint**

Replace the full `main.py` with:

```python
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
```

- [ ] **Step 2: Smoke-test the endpoint**

Start the backend:

```bash
cd backend
source ../venv/Scripts/activate   # Windows: ..\venv\Scripts\activate
uvicorn main:app --reload
```

In a second terminal:

```bash
curl -s -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d "{\"fen\":\"rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1\",\"move_log\":\"e4\",\"coach_analysis\":\"\",\"chat_history\":[],\"message\":\"What should I think about in this position?\"}"
```

Expected: JSON with a `"reply"` field containing a non-empty string. No 500 errors.

Also verify `GET http://localhost:8000/health` returns `{"status":"ok"}`.

- [ ] **Step 3: Commit**

```bash
git add backend/main.py
git commit -m "feat: add POST /chat endpoint and move_log to MoveRequest"
```

---

## Task 5: Update `index.html` — split chat panel, enable input

**Files:**
- Modify: `frontend/index.html`

- [ ] **Step 1: Replace `#chat-messages` with `#analysis-zone` + `#chat-zone`, enable input**

In `frontend/index.html`, find the `<section class="chat-section">` block and replace its interior as shown. The full updated section:

```html
        <section class="chat-section">
          <div class="chat-header">
            <span class="chat-header-ornament">&#10022;</span>
            <span>Coach</span>
          </div>
          <div id="analysis-zone" class="analysis-zone">
            <p class="analysis-placeholder">Analysis will appear after your first move.</p>
          </div>
          <div id="chat-zone" class="chat-zone"></div>
          <div class="chat-footer">
            <div class="btns-row">
              <button id="btn-undo" class="ctrl-btn ctrl-secondary" disabled>Undo</button>
              <button id="btn-hint" class="ctrl-btn ctrl-primary">Hint</button>
            </div>
            <div class="chat-input-row">
              <input type="text" id="chat-input" placeholder="Ask the coach a question...">
              <button id="btn-send" class="ctrl-btn ctrl-primary">Send</button>
            </div>
            <div class="btns-row session-btns-row">
              <button id="btn-new-game" class="ctrl-btn ctrl-secondary">New Game</button>
              <button id="btn-resign"   class="ctrl-btn ctrl-danger">Resign</button>
            </div>
          </div>
        </section>
```

Note: `disabled` attribute removed from `#chat-input` and `#btn-send` (they were not in the original HTML as disabled — the "Coming soon" was a JS-only behaviour). Verify the original HTML has no `disabled` on those elements before saving.

- [ ] **Step 2: Commit**

```bash
git add frontend/index.html
git commit -m "feat: split chat-section into analysis-zone + chat-zone"
```

---

## Task 6: Update `style.css` — analysis-zone and chat-zone styles

**Files:**
- Modify: `frontend/style.css`

- [ ] **Step 1: Replace `.chat-messages` with `.analysis-zone` and `.chat-zone`**

Find the `/* ---- Chat ---- */` section in `style.css`. The current `.chat-messages` block and its scrollbar rules span approximately lines 454–467. Replace that entire block with:

```css
.analysis-zone {
  flex: 0 0 auto;
  background: var(--bg-base);
  border-bottom: 1px solid var(--border-medium);
  padding: 0.75rem 0.95rem;
}

.analysis-placeholder {
  font-style: italic;
  color: var(--text-muted);
  font-size: 0.88rem;
  text-align: center;
  padding: 0.25rem 0;
}

.chat-zone {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  overscroll-behavior: contain;
}
.chat-zone::-webkit-scrollbar       { width: 3px; }
.chat-zone::-webkit-scrollbar-track { background: transparent; }
.chat-zone::-webkit-scrollbar-thumb { background: var(--border-medium); }
```

The old `.chat-messages` and its three scrollbar rules are deleted. Nothing else in the file changes.

- [ ] **Step 2: Commit**

```bash
git add frontend/style.css
git commit -m "feat: replace chat-messages with analysis-zone + chat-zone styles"
```

---

## Task 7: Update `app.js` — state vars, `resetChatState()`, `addMessage()`, `addCoachMessage()`

**Files:**
- Modify: `frontend/app.js`

- [ ] **Step 1: Add state vars after existing module-level vars**

Find this block near the top of `app.js`:

```js
let game = new Chess();
let board = null;
let isThinking = false;
let playerColor = 'white'; // 'white' | 'black'
let selectedSquare = null;
```

Replace with:

```js
let game = new Chess();
let board = null;
let isThinking = false;
let playerColor = 'white'; // 'white' | 'black'
let selectedSquare = null;
let currentCoachAnalysis = '';
let currentTurnChatHistory = [];
```

- [ ] **Step 2: Add `resetChatState()` helper**

Add this function immediately after the `clearHighlights()` function (around line 34):

```js
function resetChatState() {
  var analysisZone = document.getElementById('analysis-zone');
  if (analysisZone) {
    analysisZone.innerHTML = '<p class="analysis-placeholder">Analysis will appear after your first move.</p>';
  }
  var chatZone = document.getElementById('chat-zone');
  if (chatZone) chatZone.innerHTML = '';
  currentCoachAnalysis = '';
  currentTurnChatHistory = [];
}
```

- [ ] **Step 3: Update `addMessage()` to target `#chat-zone`**

Find the `addMessage` function (around line 522). Change only the first line of the function body:

Old:
```js
  var chatEl = document.getElementById('chat-messages');
```

New:
```js
  var chatEl = document.getElementById('chat-zone');
```

Everything else in the function is unchanged.

- [ ] **Step 4: Update `addCoachMessage()` to target `#analysis-zone`**

Replace the entire `addCoachMessage` function with:

```js
function addCoachMessage(text, turnInfo) {
  var analysisEl = document.getElementById('analysis-zone');

  var msg = document.createElement('div');
  msg.className = 'message coach';

  if (turnInfo) {
    var header = document.createElement('div');
    header.className = 'coach-turn-header';

    var turnLabel = document.createElement('span');
    turnLabel.className = 'coach-turn-label';
    var turnWord = document.createElement('span');
    turnWord.className = 'coach-turn-word';
    turnWord.textContent = 'Turn';
    var turnNum = document.createElement('span');
    turnNum.className = 'coach-turn-number';
    turnNum.textContent = turnInfo.turnNumber;
    turnLabel.appendChild(turnWord);
    turnLabel.appendChild(turnNum);
    header.appendChild(turnLabel);

    var movesRow = document.createElement('div');
    movesRow.className = 'coach-turn-moves';

    var wMove = document.createElement('span');
    wMove.className = 'coach-move coach-move-white';
    wMove.textContent = getPieceSymbol(turnInfo.whiteMove, 'white') + '\u00a0' + (turnInfo.whiteMove || '');

    var sep = document.createElement('span');
    sep.className = 'coach-move-sep';
    sep.textContent = '\u00b7';

    var bMove = document.createElement('span');
    bMove.className = 'coach-move coach-move-black';
    bMove.textContent = getPieceSymbol(turnInfo.blackMove, 'black') + '\u00a0' + (turnInfo.blackMove || '');

    movesRow.appendChild(wMove);
    movesRow.appendChild(sep);
    movesRow.appendChild(bMove);
    header.appendChild(movesRow);
    msg.appendChild(header);

    var divider = document.createElement('div');
    divider.className = 'coach-turn-divider';
    msg.appendChild(divider);
  }

  var content = document.createElement('div');
  content.textContent = text;
  msg.appendChild(content);

  analysisEl.innerHTML = '';
  analysisEl.appendChild(msg);
  syncLayout();
}
```

Key differences from the original: targets `#analysis-zone`; replaces content (`innerHTML = ''`) instead of appending; no `requestAnimationFrame` scroll; calls `syncLayout()` at the end.

- [ ] **Step 5: Commit**

```bash
git add frontend/app.js
git commit -m "feat: add state vars, resetChatState, update addMessage/addCoachMessage targets"
```

---

## Task 8: Update `syncLayout()` in `app.js`

**Files:**
- Modify: `frontend/app.js`

- [ ] **Step 1: Replace `syncLayout()` entirely**

Find the `syncLayout` function (starts around line 262). Replace it completely with:

```js
function syncLayout() {
  var boardEl = document.getElementById('board');
  if (!boardEl) return;

  var requestedBoardSize = getBoardSize();
  boardEl.style.width = requestedBoardSize + 'px';

  if (board) {
    board.resize();
  }

  var actualBoardSize = Math.round(boardEl.getBoundingClientRect().width) || requestedBoardSize;
  var mainPanel = document.querySelector('.main-panel');
  var chatSection = document.querySelector('.chat-section');
  var chatHeader = document.querySelector('.chat-header');
  var chatFooter = document.querySelector('.chat-footer');
  var analysisZone = document.querySelector('.analysis-zone');
  var chatZone = document.querySelector('.chat-zone');

  if (!mainPanel || !chatSection || !chatZone) return;

  if (isStackedLayout()) {
    mainPanel.style.height = '';
    mainPanel.style.maxHeight = '';
    chatSection.style.height = '300px';
    chatSection.style.maxHeight = '300px';
  } else {
    mainPanel.style.height = actualBoardSize + 'px';
    mainPanel.style.maxHeight = actualBoardSize + 'px';
    chatSection.style.height = actualBoardSize + 'px';
    chatSection.style.maxHeight = actualBoardSize + 'px';
  }

  var chatAvailableHeight = chatSection.clientHeight
    - (chatHeader ? chatHeader.offsetHeight : 0)
    - (analysisZone ? analysisZone.offsetHeight : 0)
    - (chatFooter ? chatFooter.offsetHeight : 0);

  chatZone.style.height = Math.max(chatAvailableHeight, 0) + 'px';
  chatZone.style.maxHeight = Math.max(chatAvailableHeight, 0) + 'px';
  chatZone.style.overflowY = 'auto';
  chatZone.style.overflowX = 'hidden';
  chatZone.scrollTop = chatZone.scrollHeight;
}
```

Changes from original: `chatMessages` replaced by `chatZone`; guard updated to check `!chatZone`; `analysisZone.offsetHeight` subtracted in the available height calculation.

- [ ] **Step 2: Commit**

```bash
git add frontend/app.js
git commit -m "feat: update syncLayout to account for analysis-zone height"
```

---

## Task 9: Update `app.js` — game flow functions

**Files:**
- Modify: `frontend/app.js`

- [ ] **Step 1: Update `startSetup()` to use `resetChatState()`**

Find `startSetup()`. Replace:

```js
  document.getElementById('chat-messages').innerHTML = '';
```

With:

```js
  resetChatState();
```

- [ ] **Step 2: Update `startGame()` to use `resetChatState()` and pass `move_log`**

Find `startGame(color)`. Replace:

```js
  game.reset();
  document.getElementById('chat-messages').innerHTML = '';
  clearHighlights();
```

With:

```js
  game.reset();
  resetChatState();
  clearHighlights();
```

- [ ] **Step 3: Update `executeMove()` — add `move_log`, reset state on new analysis**

Find this block inside `executeMove()` in the `try` block, where the fetch body is built:

```js
      body: JSON.stringify({ fen: preFen, move: uciMove, skill_level: getSkillLevel(), player_color: playerColor }),
```

Replace with:

```js
      body: JSON.stringify({
        fen: preFen,
        move: uciMove,
        skill_level: getSkillLevel(),
        player_color: playerColor,
        move_log: game.history().join(' '),
      }),
```

Then find the section where `addCoachMessage` is called on success:

```js
    if (engineMove) {
      board.position(game.fen());
      var turnInfo = {
        turnNumber: Math.ceil(game.history().length / 2),
        whiteMove: playerColor === 'white' ? playerSAN : engineMove.san,
        blackMove: playerColor === 'black' ? playerSAN : engineMove.san,
      };
      addCoachMessage(data.coach_comment, turnInfo);
      if (game.game_over()) handleGameOver();
    } else {
      addCoachMessage(data.coach_comment, null);
    }
```

Replace with:

```js
    currentCoachAnalysis = data.coach_comment;
    currentTurnChatHistory = [];
    document.getElementById('chat-zone').innerHTML = '';

    if (engineMove) {
      board.position(game.fen());
      var turnInfo = {
        turnNumber: Math.ceil(game.history().length / 2),
        whiteMove: playerColor === 'white' ? playerSAN : engineMove.san,
        blackMove: playerColor === 'black' ? playerSAN : engineMove.san,
      };
      addCoachMessage(data.coach_comment, turnInfo);
      if (game.game_over()) handleGameOver();
    } else {
      addCoachMessage(data.coach_comment, null);
    }
```

- [ ] **Step 4: Update `undoLastTurn()` to use `resetChatState()`**

Find `undoLastTurn()`. Replace:

```js
function undoLastTurn() {
  if (isThinking) return;
  if (game.history().length < 2) return;
  clearHighlights();
  selectedSquare = null;
  game.undo();
  game.undo();
  board.position(game.fen());
  toggleButtons(false);
}
```

With:

```js
function undoLastTurn() {
  if (isThinking) return;
  if (game.history().length < 2) return;
  clearHighlights();
  selectedSquare = null;
  game.undo();
  game.undo();
  board.position(game.fen());
  resetChatState();
  syncLayout();
  toggleButtons(false);
}
```

- [ ] **Step 5: Commit**

```bash
git add frontend/app.js
git commit -m "feat: wire resetChatState and move_log into game flow functions"
```

---

## Task 10: Update `app.js` — activate chat input and hint routing

**Files:**
- Modify: `frontend/app.js`

- [ ] **Step 1: Update `requestHint()` to route response to chat zone**

Find this line inside `requestHint()`:

```js
    addMessage(data.hint, 'coach');
```

This line now already routes correctly to `#chat-zone` (since `addMessage` was updated in Task 7). No change needed — verify and move on.

- [ ] **Step 2: Replace `btn-send` click handler**

Find the entire `btn-send` click handler block:

```js
document.getElementById('btn-send').addEventListener('click', function() {
  var input = document.getElementById('chat-input');
  var text = input.value.trim();
  if (!text) return;
  addMessage(text, 'user');
  input.value = '';
  setTimeout(function() {
    addMessage('Coming soon \u2014 free-form questions to the coach are on the way!', 'system');
  }, 200);
});
```

Replace with:

```js
document.getElementById('btn-send').addEventListener('click', async function() {
  var input = document.getElementById('chat-input');
  var text = input.value.trim();
  if (!text || isThinking) return;
  input.value = '';

  addMessage(text, 'user');

  isThinking = true;
  toggleButtons(true);

  try {
    var res = await fetch(BACKEND + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fen: game.fen(),
        move_log: game.history().join(' '),
        coach_analysis: currentCoachAnalysis,
        chat_history: currentTurnChatHistory,
        message: text,
      }),
    });

    if (!res.ok) {
      var err = await res.json().catch(function() { return {}; });
      addMessage('Error: ' + (err.detail || res.status), 'system');
      return;
    }

    var data = await res.json();
    addMessage(data.reply, 'coach');
    currentTurnChatHistory.push({ role: 'user', text: text });
    currentTurnChatHistory.push({ role: 'coach', text: data.reply });

  } catch (err) {
    addMessage('Cannot reach the server.', 'system');
  } finally {
    isThinking = false;
    toggleButtons(false);
  }
});
```

Note: history is only updated on success — failed exchanges are not stored.

- [ ] **Step 3: Verify keydown handler is unchanged**

The existing keydown handler:

```js
document.getElementById('chat-input').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') document.getElementById('btn-send').click();
});
```

This still works correctly — it triggers the updated click handler. No change needed.

- [ ] **Step 4: End-to-end manual verification**

Start backend (`uvicorn main:app --reload` in `backend/` with venv active).
Open `frontend/index.html` via Live Server (port 5500).

Check:
1. Setup overlay shows correctly; start a game as White.
2. Analysis zone shows placeholder text on game start.
3. Make a move — analysis zone is replaced with turn header + 2-sentence analysis; chat zone clears.
4. Click Hint — hint appears in chat zone, analysis zone unchanged.
5. Type a question in chat input, press Send — user message appears in chat zone, coach reply appears below it.
6. Make a second move — analysis zone replaces with new analysis; chat zone clears.
7. Click Undo — analysis zone shows placeholder; chat zone is empty.
8. Resize the window — layout adjusts correctly; analysis zone remains fully visible.

- [ ] **Step 5: Commit**

```bash
git add frontend/app.js
git commit -m "feat: activate chat input with POST /chat, route hint to chat zone"
```

---

## Task 11: Update `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add new architecture section**

Append a new section after the existing `## Fix (sessione 2026-03-31...)` section:

```markdown
## Coaching refactor (sessione 2026-03-31 — round 2)

### Chat panel split

`.chat-section` is now a flex column with two children between the header and footer:

| Zone | Element | Behaviour |
|---|---|---|
| Analysis zone | `#analysis-zone` `.analysis-zone` | `flex: 0 0 auto`; always fully visible; content replaced on every turn via `addCoachMessage()`; shows placeholder when empty |
| Chat zone | `#chat-zone` `.chat-zone` | `flex: 1; min-height: 0; overflow-y: auto`; scrollable; accumulates hints, user messages, coach replies; cleared on every new analysis and on undo |

`#chat-messages` is removed. `addMessage()` now targets `#chat-zone`. `addCoachMessage()` targets `#analysis-zone` and replaces content (does not append).

### Per-turn context model

| Event | Analysis zone | Chat zone | `currentCoachAnalysis` | `currentTurnChatHistory` |
|---|---|---|---|---|
| `startGame()` | placeholder | clear | `""` | `[]` |
| POST /move response | replace with analysis | clear | set | `[]` |
| Hint response | unchanged | append coach message | unchanged | unchanged |
| User sends message | unchanged | append user + coach reply | unchanged | append both on success |
| `undoLastTurn()` | placeholder | clear | `""` | `[]` |

`resetChatState()` helper encapsulates the above reset logic.

### New state vars (`app.js`)

- `currentCoachAnalysis: string` — set on each POST /move response; cleared on undo/new game
- `currentTurnChatHistory: Array<{role: 'user'|'coach', text: string}>` — cleared on new analysis and undo; passed to POST /chat as context

### Chat available from game start

The chat input is active as soon as a game starts. `POST /chat` handles empty `coach_analysis` and empty `move_log` gracefully (omits those context lines from the Groq prompt).

### POST /move — updated

`MoveRequest` now includes `move_log: str = ""`. Passed to `get_coach_comment()` and included in the Groq user message as `"Move history: {move_log}"`. `context` parameter removed from `get_coach_comment`. `max_tokens` lowered from 600 → 180.

### POST /chat — new endpoint

```
POST /chat
Body: { fen, move_log, coach_analysis, chat_history, message }
Response: { reply }
```

`get_chat_reply()` in `groq_client.py`: builds message history from `chat_history` (role `"coach"` → `"assistant"`), injects context (FEN, move_log, coach_analysis) into the current user message. System prompt: `backend/prompts/chat_reply.txt`. `max_tokens`: 300.

### POST /hint — frontend change only

Hint response already called `addMessage(data.hint, 'coach')`. Since `addMessage` now targets `#chat-zone`, hints appear in the chat zone automatically. No backend changes.
```

- [ ] **Step 2: Update feature roadmap**

Find the "Contextual chat with the coach" item in the Ideas backlog section. Mark it as done and add a reference to the new section:

```markdown
### ~~Contextual chat with the coach~~ ✓ DONE (sessione 2026-03-31 — round 2)
See "Coaching refactor" section above. POST /chat endpoint implemented with full context (FEN, move log, prior analysis, conversation history).
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with coaching refactor architecture"
```
