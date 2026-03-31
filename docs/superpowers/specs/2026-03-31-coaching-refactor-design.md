# Coaching System Refactor — Design Spec
_Date: 2026-03-31_

---

## Overview

Significant refactor of the coaching panel. Splits the single scrollable chat into two distinct zones, introduces per-turn context isolation, activates the free-form chat input via a new `/chat` endpoint, and tightens the post-move analysis to 2 sentences.

---

## 1. Chat Panel — Split Layout

### Structure

`.chat-section` becomes a flex column with two new child zones between the header and footer:

```
.chat-section (flex column, height set by syncLayout)
├── .chat-header            — unchanged ("Coach" label)
├── .analysis-zone          — flex: 0 0 auto (NEW)
│     · Sizes to content; no max-height, no overflow clipping
│     · Always fully visible — cannot scroll out of view
│     · Shows placeholder when empty; coach turn header + text when populated
├── .chat-zone              — flex: 1; min-height: 0; overflow-y: auto (NEW)
│     · Scrollable
│     · Receives: hints, user messages, coach chat replies, system messages
└── .chat-footer            — unchanged (Undo, Hint, input row, session buttons)
```

The existing `#chat-messages` div is **replaced** by `#analysis-zone` and `#chat-zone`.

### Visual style — `.analysis-zone`

- `background: var(--bg-base)` — one step darker than `var(--bg-surface)`, reads as "board context"
- `border-bottom: 1px solid var(--border-medium)` — separates it from chat zone
- `padding: 0.75rem 0.95rem`
- Placeholder state: `font-style: italic; color: var(--text-muted); font-size: 0.88rem`
  - Text: _"Analysis will appear after your first move."_
- Populated state: same `.coach-turn-header` / `.coach-turn-divider` / content structure as today's `addCoachMessage()`

### `syncLayout()` update

`syncLayout()` continues to set `chatSection.style.height` explicitly (unchanged). It then additionally sets:

```js
chatZone.style.height = (
  chatSection.clientHeight
  - chatHeader.offsetHeight
  - analysisZone.offsetHeight
  - chatFooter.offsetHeight
) + 'px';
```

This is the same pattern as the current `chatMessages` sizing, extended for the split. `chatZone` gets `overflow-y: auto` via CSS; `syncLayout()` does not set it imperatively.

---

## 2. Per-Turn Context Model

### New module-level state vars (`app.js`)

```js
let currentCoachAnalysis = "";     // set on POST /move response; cleared on undo/new game
let currentTurnChatHistory = [];   // [{role: "user"|"coach", text: str}]; cleared on new analysis + undo/new game
```

`currentFen` is not a new var — read from `game.fen()` at send time.

### Lifecycle

| Event | Analysis zone | Chat zone | `currentCoachAnalysis` | `currentTurnChatHistory` |
|---|---|---|---|---|
| `startGame()` | show placeholder | clear | `""` | `[]` |
| POST /move response | replace content | **clear** | set to new text | `[]` |
| Hint response | unchanged | append coach message | unchanged | unchanged |
| User sends chat message | unchanged | append user + coach reply | unchanged | append both |
| `undoLastTurn()` | show placeholder | clear | `""` | `[]` |

### Move log

`move_log: game.history().join(' ')` is passed in every `POST /move` body. It is derived from `game.history()` which is already undo-aware — no separate tracking needed.

---

## 3. Backend Changes

### `POST /move` — tighter analysis

**`backend/main.py`**
- `MoveRequest` gains `move_log: str = ""`
- `move_log` passed to `get_coach_comment()`
- Remove the `context` parameter from the `get_coach_comment()` call (it was always `""`)

**`backend/groq_client.py`**
- `get_coach_comment()` signature: remove `context: str = ""` param; add `move_log: str = ""`
- Add `"Move history: {move_log}\n"` line to user message (omit line if `move_log` is empty)
- `max_tokens`: 600 → **180**

**`backend/prompts/coach_comment.txt`** — add two constraints at the top of the rules:
- _Maximum 2 sentences._
- _This is a brief analysis, not a conversation — do not invite follow-up or ask questions._

### `POST /chat` — new endpoint

**`backend/main.py`**

```python
class ChatRequest(BaseModel):
    fen: str
    move_log: str
    coach_analysis: str
    chat_history: list   # [{role: "user"|"coach", text: str}]
    message: str

@app.post("/chat")
def chat(req: ChatRequest):
    reply = get_chat_reply(
        req.fen, req.move_log, req.coach_analysis,
        req.chat_history, req.message
    )
    return {"reply": reply}
```

Note: sync `def`, not `async def` — consistent with `post_move` and `post_hint`. The Groq SDK client is synchronous.

**`backend/groq_client.py`** — add `get_chat_reply()`:
- Load system prompt from `backend/prompts/chat_reply.txt`
- Build messages list:
  1. `system`: the chat_reply prompt
  2. First `user` turn: context block only — `"FEN: {fen}\nMove history: {move_log}\nCoach analysis: {coach_analysis}"` (omit fields that are empty)
  3. For each entry in `chat_history` (oldest first): `role = "user"` if `entry["role"] == "user"` else `role = "assistant"`, `content = entry["text"]`
  4. Final `user` turn: `req.message`
- This structure is correct whether `chat_history` is empty (2 messages: context + question) or non-empty (context, then history exchanges, then new question)
- `max_tokens`: 300, `temperature`: 0.7
- Retry loop (3 attempts, 0.5s sleep) — same pattern as `get_coach_comment`
- Raises `RuntimeError` on 3 empty responses

**`backend/prompts/chat_reply.txt`** — new file:
```
You are a chess coach in an ongoing conversation with the player.
You have already analyzed the last turn — the analysis is provided as context.
Answer the player's question naturally, using the position and move history as context.
Be concrete and specific — refer to actual pieces and squares when relevant.
Never reveal centipawn scores.
Max 3 sentences unless a longer answer is clearly needed.
No filler: never start with "Sure!", "Absolutely!", "Of course!".
```

### `POST /hint` — no backend changes

---

## 4. Frontend Wiring

### `app.js` changes

**Chat input — active from game start**
- Remove the "Coming soon" disabled state from `btn-send` and `#chat-input`
- `btn-send` is disabled only during `isThinking` (via `toggleButtons`)

**`requestHint()`**
- Change `addMessage(data.hint, 'coach')` → `addChatMessage(data.hint, 'coach')`
  (routes hint to `.chat-zone`, not analysis zone)

**New `addChatMessage(text, type)` function**
- Same structure as current `addMessage()` but targets `#chat-zone`
- Handles types: `'coach'`, `'user'`, `'system'`

**`addCoachMessage(text, turnInfo)`**
- Targets `#analysis-zone` — replaces innerHTML (not appends)
- Shows turn header + divider + text as today
- After setting content, calls `syncLayout()` (analysis zone height changed)

**`btn-send` handler**
```
1. read input text, guard empty
2. addChatMessage(text, 'user')
3. append {role:'user', text} to currentTurnChatHistory
4. POST /chat with {fen: game.fen(), move_log: game.history().join(' '),
                    coach_analysis: currentCoachAnalysis,
                    chat_history: currentTurnChatHistory, message: text}
5. addChatMessage(reply, 'coach')
6. append {role:'coach', text: reply} to currentTurnChatHistory
```

**`undoLastTurn()`**
- After `game.undo() × 2` and `board.position()`: clear analysis zone (restore placeholder), clear chat zone, reset `currentCoachAnalysis = ""` and `currentTurnChatHistory = []`, call `syncLayout()`

**`startGame()`**
- Same reset as undo for analysis zone, chat zone, state vars

**`executeMove()` on POST /move success**
- Set `currentCoachAnalysis = data.coach_comment`
- Reset `currentTurnChatHistory = []`
- Call `addCoachMessage()` (which replaces analysis zone and calls syncLayout)
- Clear chat zone

**`toggleButtons`** — add `'btn-send'` (already present per current code — confirm it stays)

---

## 5. CLAUDE.md Update

New section to document:
- Split panel: analysis zone (top, `flex: 0 0 auto`, always visible) + chat zone (scrollable, `flex: 1`)
- Per-turn context: chat clears on each new coach analysis and on undo; `currentCoachAnalysis` and `currentTurnChatHistory` managed in `app.js`
- Chat available from game start (not gated on first move)
- `POST /move`: now receives `move_log`; `context` param removed
- `POST /chat`: new endpoint for free-form conversation with context
- `POST /hint`: response routed to chat zone

---

## Files Changed

| File | Change |
|---|---|
| `frontend/index.html` | Replace `#chat-messages` with `#analysis-zone` + `#chat-zone` |
| `frontend/app.js` | Split message targets, new state vars, chat wiring, syncLayout update |
| `frontend/style.css` | `.analysis-zone`, `.chat-zone` styles; remove `.chat-messages` |
| `backend/main.py` | `MoveRequest.move_log`, `ChatRequest`, `POST /chat` endpoint |
| `backend/groq_client.py` | `get_coach_comment` signature update, `get_chat_reply()` |
| `backend/prompts/coach_comment.txt` | Add 2-sentence + no-follow-up constraints |
| `backend/prompts/chat_reply.txt` | New file |
| `CLAUDE.md` | Document new architecture |
