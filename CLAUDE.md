# chess-training — Stato del progetto

## Obiettivo
Applicazione web per allenarsi agli scacchi con feedback in tempo reale da un coach AI.
Il backend combina Stockfish (analisi engine) con Groq LLM (commenti in linguaggio naturale).
Il frontend è vanilla HTML/CSS/JS, nessun build step.

---

## Struttura del progetto

```
chess-training/
├── backend/
│   ├── main.py               # Server FastAPI (porta 8000)
│   ├── stockfish_bridge.py   # Comunicazione con Stockfish via python-chess
│   ├── groq_client.py        # Chiamate a Groq API + conversione UCI→SAN
│   ├── .env                  # Variabili d'ambiente (non in git)
│   └── prompts/
│       ├── coach_comment.txt # System prompt per commento post-mossa
│       └── hint_comment.txt  # System prompt per suggerimento strategico
├── frontend/
│   ├── index.html            # Layout a due colonne
│   ├── style.css             # Dark theme, responsive ≤800px
│   ├── app.js                # Logica JS
│   └── lib/
│       ├── chessboard.js     # Scaricato da unpkg (patched per browser)
│       └── chessboard.css    # Scaricato da unpkg
├── venv/                     # Virtualenv Python
├── .env.example              # Template variabili d'ambiente
└── CLAUDE.md                 # This file (project context)
```

---

## Come avviare

### Backend
```bash
cd backend
# First time only:
python -m venv ../venv
source ../venv/bin/activate   # Windows: ..\venv\Scripts\activate
pip install fastapi uvicorn python-chess groq python-dotenv httpx
# Every time:
source ../venv/bin/activate   # Windows: ..\venv\Scripts\activate
uvicorn main:app --reload
```
Richiede `backend/.env` con `GROQ_API_KEY` e `STOCKFISH_PATH` compilati (vedi `.env.example`).

### Frontend
Aprire `frontend/index.html` con Live Server (VS Code) su porta 5500,
oppure: `python -m http.server 5500` dalla cartella `frontend/`.
Il frontend si aspetta il backend su `http://localhost:8000`.

---

## Backend

### Dipendenze (venv)
`fastapi`, `uvicorn`, `python-chess`, `groq`, `python-dotenv`, `httpx`

### `stockfish_bridge.py`
Apre/chiude Stockfish per ogni chiamata tramite `chess.engine` (UCI).

| Funzione | Parametri | Comportamento |
|---|---|---|
| `get_best_move` | `fen, skill_level` | Risposta engine in UCI (`"e2e4"`) |
| `analyze_position` | `fen` | `{score, best_move, depth}` — depth 20 |
| `get_hint` | `fen` | `{score, best_move, depth}` — depth 20 |

`score`: `int` (centipawns) oppure `"mate N"`.

### `groq_client.py`
Client Groq singleton. Modello: `gpt-oss-120b`.
Le mosse vengono convertite da UCI a SAN prima di essere passate al prompt
(helper `_uci_to_san`, con fallback alla stringa UCI in caso di eccezione).
`best_move` viene convertito usando il FEN pre-mossa (corrisponde alla posizione in cui quella mossa è legale).

| Funzione | Scopo |
|---|---|
| `get_coach_comment(fen, player_move, analysis, engine_move, context, player_color)` | Commento post-mossa |
| `get_hint_comment(fen, analysis)` | Suggerimento strategico (senza rivelare la mossa) |

### `main.py` — Endpoint API

CORS: `localhost:3000`, `localhost:5173`, `127.0.0.1:5500`.
`load_dotenv()` chiamato all'avvio prima di qualsiasi import che usa env vars.

| Endpoint | Body | Risposta |
|---|---|---|
| `GET /health` | — | `{"status":"ok"}` |
| `POST /move` | `{fen, move, skill_level, player_color}` | `{engine_move, coach_comment, score}` |
| `POST /hint` | `{fen}` | `{hint}` |

`POST /move`: valida FEN → valida mossa UCI → verifica legalità → **analizza posizione pre-mossa** (depth 20, best_move = alternativa migliore per il bianco) → applica mossa → ottiene risposta engine → chiede commento a Groq con analisi pre-mossa.

---

## Prompt LLM

### `coach_comment.txt`
Player-aware: coach addresses the player as "you/your move" and the opponent by color. Max 3 sentences. No hollow praise. Explains strategic concepts concisely. Never reveals centipawns or the exact best move.

### `hint_comment.txt`
Max 2 sentences. Never reveals the exact move. Suggests strategic themes or board area.

---

## Frontend

### Librerie
| Libreria | Fonte | Note |
|---|---|---|
| jQuery 3.7.1 | cdnjs (CDN) | Richiesto da chessboard.js |
| chess.js 0.10.3 | cdnjs (CDN) | Logica scacchiera, validazione mosse |
| chessboard.js | `frontend/lib/` (locale) | Rendering drag & drop. CDN bloccata da ORB — vedi bug |

### Layout
Setup overlay a schermo intero → scelta colore (bianco/nero) → game container.
`.main-panel` a due colonne: scacchiera (sinistra, dimensione JS-driven) + chat 300px (destra).
Breakpoint 860px: colonne si impilano. Dark theme (`#0c0c0f`), palette oro (`#c9a866`).
Font: Cormorant Garamond (display) + Crimson Pro (body) via Google Fonts CDN.
Messaggi chat: `coach` con bordino oro, `system` corsivo centrato, `user` bordino blu.

### `app.js` — flusso
- `startSetup()`: mostra overlay, resetta board/chat
- `startGame(color)`: nasconde overlay, crea board con orientamento corretto, chiama `syncLayout()`
- `engineFirstMove()`: se giocatore sceglie nero, engine apre con mossa random da `WHITE_OPENINGS`
- `onDragStart`: blocca se engine sta pensando, partita finita, o pezzo avversario / turno avversario
- `onDrop`: valida con chess.js → `POST /move` → `addCoachMessage(turnInfo)` → applica mossa engine
- `addCoachMessage(text, turnInfo)`: bolla coach con header turno (numero + notazione bianco/nero)
- Errore di rete: `game.undo()` + messaggio in chat
- `undoLastTurn()`: `game.undo()` × 2, disabilitato se < 2 mosse in cronologia
- `syncLayout()`: calcola dimensione board, imposta `#board` width, chiama `board.resize()`, allinea altezze `main-panel` e `chat-section` alla board reale renderizzata
- `toggleButtons(disabled)`: disabilita tutti i bottoni durante le chiamate async

---

## Fix (sessione 2026-03-28 — round 3)

| Fix | Cosa |
|---|---|
| Prompt LLM in inglese | `coach_comment.txt` e `hint_comment.txt` riscritti interamente in inglese, max 2 frasi ciascuno |
| `get_hint` depth | Portato da 10 a 20 per coerenza con `analyze_position` |
| Modello LLM | Cambiato da `llama-3.1-8b-instant` a `gpt-oss-120b` in `groq_client.py` e `context.md` |
| `max_tokens` hint | Portato da 200→400→600 in `get_hint_comment()` |
| Log warning risposta vuota | `/move` e `/hint` loggano `[WARN]` se `coach_comment`/`hint` è vuoto/None |
| Nessun try/except silenzioso | Confermato: entrambe le funzioni Groq propagano già le eccezioni; solo `_uci_to_san` ha fallback intenzionale |

---

## Fix (sessione 2026-03-28 — round 2)

| Fix | Problema | Soluzione |
|---|---|---|
| Ordine operazioni POST /move | `analyze_position` veniva chiamato dopo il push → restituiva `best_move` del nero, non del bianco | Spostato prima di `board.push`: ora analizza la posizione pre-mossa |
| Conversione SAN best_move in groq_client | Usava un board post-mossa per convertire una mossa della posizione pre-mossa | Ora usa direttamente `fen` (pre-mossa) |
| Prompt coach_comment.txt | Tono troppo incoraggiante, frasi di maniera | Riscritto: tono asciutto, max 2–3 frasi, niente "ottima mossa!" |

---

## Bug risolti (sessione 2026-03-28)

| Bug | Causa | Fix |
|---|---|---|
| `ERR_BLOCKED_BY_ORB` su chessboard.js | Il path CDN `chessboard-1.0.0.min.js` non esiste nel pacchetto npm; CDN restituisce errore con MIME sbagliato | File scaricato localmente in `frontend/lib/` |
| `module is not defined` | Bare `module.exports = ChessBoard` senza guard nel file scaricato | Patched localmente: guard + `window.ChessBoard = ChessBoard` |
| `Chessboard is not defined` | Capitalizzazione errata in app.js (`Chessboard` vs `ChessBoard`) | Sed replace in app.js |
| jQuery mancante | La versione del pacchetto npm richiede jQuery | Aggiunto jQuery 3.7.1 da cdnjs |
| Notazione UCI nel coach_comment | `best_move` passato grezzo come "e6e5" | `groq_client.py` ora converte UCI→SAN via python-chess |

---

## Stato attuale

**Backend e frontend funzionanti e testati end-to-end (2026-03-31).**

Flusso verificato: setup overlay → scelta colore → mossa giocatore → Stockfish risponde → coach commenta con bolla turno (notazione bianco/nero) → suggerimento funziona → undo funziona.

## Prossimi passi

- Rendere il tono del coach più progressivo/didattico per giocatori inesperti (prompt update)
- Contextual chat with the coach (POST /chat endpoint — see Ideas backlog)

---

## Piece sets & board themes (sessione 2026-03-31)

### Piece sets downloaded
SVG files (12 per set: wK wQ wR wB wN wP bK bQ bR bB bN bP) saved to `frontend/lib/pieces/<setname>/`.
Source: `https://raw.githubusercontent.com/lichess-org/lila/master/public/piece/<setname>/<piece>.svg`

Sets available: **cburnett** (default), **staunty**, **merida**, **maestro**, **tatiana**, **california**, **riohacha** (all 7 verified 200 OK).

pieceTheme path format: `lib/pieces/{setname}/{piece}.svg`

### Board themes

Four CSS themes defined in `style.css`, applied as a class on `#board`:

| Class | Light square | Dark square |
|---|---|---|
| `.board-theme-classic` | `#f0d9b5` | `#b58863` (default, no override) |
| `.board-theme-walnut` | `#dab882` | `#6b3a22` |
| `.board-theme-slate` | `#adbbc4` | `#456070` |
| `.board-theme-midnight` | `#3a4055` | `#1a1e2e` |

Overrides chessboard.js square classes `.white-1e1d7` and `.black-3c85d`.

### Settings panel

- Gear button (`#btn-gear`, class `.btn-gear`) added to header top-right (inside `.header-controls`)
- Clicking it toggles `#settings-panel` (position: fixed, top-right, z-index 200)
- `#settings-backdrop` (full-screen invisible div, z-index 199) dismisses panel on click-outside
- Panel contains: piece set buttons grid + board theme swatches with mini checkerboard previews

### Setup overlay additions

- New `.appearance-section` added below `.difficulty-section` in setup card
- Contains `#setup-piece-grid` (piece set buttons) and `#setup-theme-row` (theme swatches)
- `.setup-card` gets `max-height: 92vh; overflow-y: auto` to handle taller overlay content

### State management

- `localStorage['chessPieceSet']` — set name string, default `'cburnett'`
- `localStorage['chessBoardTheme']` — theme name string, default `'classic'`
- Read on page load; applied before board init

### app.js refactor

- `initBoard(fen, orientation)` extracted as shared board initializer
  - destroys existing board, sets width, creates ChessBoard with current pieceTheme, applies board theme, calls syncLayout()
  - used by `startGame()` and `setPieceSet()`
- `getPieceSet()` / `getBoardTheme()` read from localStorage with defaults
- `getPieceThemeUrl(setName)` returns `lib/pieces/<setname>/{piece}.svg`
- `applyBoardTheme(themeName)` removes all `.board-theme-*` classes, adds new one
- `setPieceSet(setName)` saves to localStorage, refreshes selectors, calls `initBoard()` mid-game preserving FEN + orientation
- `setBoardTheme(themeName)` saves to localStorage, calls `applyBoardTheme()`, refreshes selectors
- `buildSwatches(gridEl, rowEl)` builds piece-set buttons and theme swatch buttons for any container pair
- `refreshAllSelectors()` rebuilds both the settings panel and setup overlay selectors
- `openSettings()` / `closeSettings()` toggle panel + backdrop + gear active state
- `setPlayerColor()` helper removed (logic absorbed into `initBoard()` + `startGame()`)

---

## Redesign UI (sessione 2026-03-29)

### Motivazione
Interfaccia originale troppo prototipale. Redesign completo orientato a un look "chess club di alto livello" — scuro, raffinato, tipografia serif, nessun effetto da videogioco.

### Modifiche applicate

#### `frontend/index.html`
- Aggiunto Google Fonts CDN: **Cormorant Garamond** (display) + **Crimson Pro** (body)
- Nuovo **setup overlay** (`#setup-overlay`): schermata a tutto schermo con card centrata, due bottoni colore (bianco/nero) con `data-color`
- Struttura game container (`#game-container`) con classe `hidden` / visibile
- Header (`app-header`): logo sinistra + tre bottoni destra (`btn-new-game`, `btn-resign`, `btn-hint`)
- Layout a due sezioni: `board-section` (flex: 1) + `chat-section` (360px fissi)
- Rimosso bottone hint dal footer chat; rimosso btn-new-game dalla colonna board

#### `frontend/style.css`
- Riscrittura completa. Palette: near-black base (`#0c0c0f`), oro caldo (`#c9a866`), crema (`#e8dfc8`)
- Setup overlay con pattern scacchiera CSS molto sottile come sfondo
- Animazioni: `fadeIn` + `slideUp` per la card, `msgIn` per i messaggi chat
- Board frame: padding 14px + bordo oro + box-shadow profondi
- Bottoni: `.ctrl-secondary`, `.ctrl-primary`, `.ctrl-danger` — flat, no border-radius, tono discreto
- `#board width`: `clamp(300px, calc(100vw - 380px - 4rem - 28px), 560px)` — responsive automatico
- Chat: `flex: 0 0 360px`, messaggi `coach` con bordino oro, `system` corsivo centrato, `user` bordino blu
- Breakpoint 860px: layout verticale. Breakpoint 500px: color-choice impila verticalmente

#### `frontend/app.js`
- Aggiunto `playerColor` (`'white'` | `'black'`)
- `startSetup()`: mostra overlay, nasconde game container, resetta board/chat
- `startGame(color)`: nasconde overlay, crea board con `orientation: color`, avvia partita
- `engineFirstMove()`: se giocatore sceglie nero, engine muove subito con apertura random da `WHITE_OPENINGS`
- `resign()`: alias per `startSetup()`
- `onDragStart` aggiornato: controlla `playerColor` e `game.turn()` — solo i propri pezzi nel proprio turno
- `toggleButtons` esteso a includere `btn-resign`
- Event listener aggiunto per `btn-resign` e `.color-btn` (click su scelta colore)
- `addMessage` system: label rimossa (solo testo corsivo)
- Avvio: `startSetup()` invece di `initBoard() + addMessage()`
- Nessuna dipendenza dal backend per `engineFirstMove` (mossa locale da lista predefinita)

### Note
- Il backend rimane invariato. `POST /move` funziona correttamente anche con giocatore nero:
  il FEN inviato ha il turno del nero, e Stockfish risponde con la mossa del bianco.
- Font caricati via CDN Google Fonts (richiede connessione internet).


## Fix layout centrato (sessione 2026-03-29 — round 2)

| Modifica | Prima | Dopo |
|---|---|---|
| .game-layout | nessun justify-content, si espandeva a tutta larghezza | justify-content: center + align-items: stretch, board+chat centrati come unita |
| .board-section | flex: 1 + min-width: 0, occupava tutto lo spazio a sinistra | flex: none, dimensione determinata dal contenuto |
| #board | clamp relativo al viewport | 480px fisso, breakpoint 860px gestisce il mobile |

### Risultato visivo
Board (480px) + chat (300px) = 780px di contenuto, centrati nella viewport. Nessuno spazio vuoto a sinistra della scacchiera. Header rimane full-width come barra di navigazione.


## Fix layout height-driven / chess.com style (sessione 2026-03-29 — round 3)

Obiettivo: board e chat stesso blocco compatto, altezza = viewport disponibile.

Principio: la scacchiera si adatta all'altezza, non viceversa.

Modifiche a frontend/style.css:

| Selettore | Prima | Dopo |
|---|---|---|
| .board-section padding | 2.5rem 2rem | 1rem 1.5rem |
| .board-frame | nessun height/aspect-ratio | height:100% + max-height:560px + aspect-ratio:1/1 + overflow:hidden |
| #board | width:480px fisso | width:100% + height:100% (riempie board-frame) |
| media 860px | nessun reset | .board-frame height:auto + max-height:none + #board height:auto |

Comportamento risultante:
- game-layout (flex:1) riempie tutta l'altezza sotto l'header
- board-section (flex:none, align-items:stretch) si allunga alla stessa altezza di game-layout
- board-frame (height:100%, max-height:560px, aspect-ratio:1/1) diventa un quadrato di lato = min(560px, altezza disponibile)
- #board riempie il board-frame al 100%
- chat-section (flex:0 0 300px, align-items:stretch) stessa altezza di board-section
- Nessuno spazio vuoto verticale; centrato orizzontalmente da justify-content:center su game-layout
- Mobile (<=860px): il layout torna width-driven con il breakpoint che reimposta height:auto


## Backend i18n fix + JS-driven board sizing (sessione 2026-03-29 - round 4)

### Backend: groq_client.py user message labels translated to English
All user message field labels passed to Groq were in Italian. Translated to English:
- Posizione FEN -> FEN position
- Mossa del giocatore -> Player's move
- Valutazione engine -> Engine evaluation
- Mossa migliore secondo engine -> Engine best move
- Contesto aggiuntivo -> Additional context

Both prompts in backend/prompts/ were already fully in English.

### Frontend: JS-driven board sizing (chess.com style)

Problem: chessboard.js reads #board computed width via jQuery at init time.
CSS-only approach (aspect-ratio + height:100%) was unreliable because chessboard.js
does not respond to CSS changes without explicit board.resize() calls.

Solution: calculate board size in JS and set #board style.width before init and on resize.

#### New function in app.js: getBoardSize()
- On mobile (<=860px): width-driven. boardSize = min(window.innerWidth - 32 - 28, 460)
- On desktop: height-driven. boardSize = min(window.innerHeight - headerHeight - 32 - 28, 560)
- 32 = board-section vertical/horizontal padding (2 * 1rem)
- 28 = board-frame inner padding (2 * 14px)

#### Changes to app.js
- getBoardSize() added before startGame()
- startGame() sets document.getElementById('board').style.width = boardSize + 'px' before ChessBoard init
- resize listener: sets #board width then calls board.resize()

#### Changes to style.css
- .board-frame: removed height:100%, max-height:560px, aspect-ratio:1/1
- #board: changed from width:100%; height:100% to display:block (width set by JS)
- Media query 860px: removed .board-frame and #board overrides (JS handles sizing in both modes)


## Unified main-panel layout (sessione 2026-03-30)

### Obiettivo
Board e chat appaiono come un unico blocco visivo (pannello diviso a due colonne),
non due elementi separati.

### Modifiche a frontend/index.html
- Aggiunto wrapper <div class="main-panel"> che contiene .board-section e .chat-section
- Rimosso #btn-hint dall'header
- Aggiunto #btn-hint nella .chat-footer, sopra la riga input (con classe .hint-btn)

### Modifiche a frontend/style.css
- .game-layout: align-items cambiato da stretch a center (panel centrato verticalmente)
- .main-panel aggiunto: display:flex, flex-direction:row, align-items:stretch,
  border:1px solid var(--border-gold), box-shadow profondi, overflow:hidden
- .board-frame: rimossi box-shadow e border-gold; nuovo border:1px solid var(--border-medium)
  (il main-panel porta ora il bordo esterno prominente)
- .hint-btn aggiunto: display:block, width:100%, margin-bottom:0.5rem, text-align:center
- Media query 860px: aggiunto align-items:stretch su .game-layout, .main-panel {flex-direction:column}

### Non modificato
- app.js: nessuna modifica. toggleButtons usa ID (btn-hint), funziona indipendentemente dalla
  posizione nel DOM. Event listener su #btn-hint funziona per lo stesso motivo.


## Fix chat scroll (sessione 2026-03-30)

CSS-only approaches (height chain, `height: 0` trick) were tried and abandoned — both fragile across browsers.

**Final approach (implemented by Codex):** `syncLayout()` in `app.js` reads the real rendered board width via `getBoundingClientRect()` after `board.resize()`, then sets `main-panel` and `chat-section` to that exact height in px. `.chat-messages` (flex: 1, `overflow-y: auto`, `min-height: 0`) scrolls internally. No CSS height chain needed.


## Fix board-height locked panel + chat self-scroll (sessione 2026-03-30 — round 2, Codex)

### Autore
Questa iterazione è stata implementata da **Codex**, non da Claude Code.
La cronologia sopra resta invariata: questo blocco documenta semplicemente il passo successivo
nella timeline del 2026-03-30.

### Problema
La chat risultava allineata all'altezza del pannello esterno, non all'altezza effettiva
della scacchiera renderizzata. Inoltre, con `overflow-y: auto`, i messaggi potevano ancora
far crescere il contenitore invece di scrollare internamente.

### Strategia finale
Usare la scacchiera renderizzata come unica sorgente di verità per l'altezza desktop:
- `#board` riceve una larghezza calcolata via JS
- `chessboard.js` la converte nel lato reale del quadrato
- `main-panel` e `chat-section` vengono poi forzati a quella **altezza reale**
- solo `.chat-messages` resta scrollabile

### Modifiche a `frontend/app.js`
- Aggiunta `isStackedLayout()` per distinguere desktop e mobile (`<= 860px`)
- `getBoardSize()` aggiornato:
  - desktop: limita la board sia in base all'altezza disponibile sia in base alla larghezza residua accanto alla chat
  - mobile: mantiene un sizing prudente in funzione della viewport
- Aggiunta `syncLayout()`:
  - imposta la width richiesta di `#board`
  - chiama `board.resize()`
  - legge la width reale renderizzata con `getBoundingClientRect().width`
  - imposta `main-panel` e `chat-section` alla stessa altezza della board su desktop
  - calcola l'altezza disponibile per `.chat-messages` come:
    `chatSection.clientHeight - chatHeader.offsetHeight - chatFooter.offsetHeight`
  - forza `.chat-messages` a `overflowY = 'auto'`
  - riallinea lo scroll in basso dopo ogni sync
- `startGame()` ora inizializza la board e poi chiama `syncLayout()`
- Il listener `resize` usa direttamente `syncLayout()`
- `addMessage()` usa `requestAnimationFrame(...)` prima di fare `scrollTop = scrollHeight`,
  così l'autoscroll avviene dopo il layout effettivo del nuovo messaggio

### Modifiche a `frontend/style.css`
- `.main-panel`: rimossi bordo superiore/inferiore per evitare che il pannello risultasse
  più alto della board quando l'altezza viene fissata via JS
- `.board-section`:
  - `height: 100%`
  - padding verticale rimosso (`padding: 0 1.5rem`)
- `.board-frame`:
  - `height: 100%`
  - rimossi padding, background e border
  - lasciato solo come wrapper di allineamento, senza aggiungere altezza extra
- `.chat-section`: aggiunto `min-height: 0`
- `.chat-messages`:
  - confermato `overflow-y: auto`
  - confermato `min-height: 0`
  - aggiunto `overscroll-behavior: contain`
- Media query `<= 860px`:
  - `.board-section` torna a `height: auto`
  - `.board-frame` torna a `height: auto`

### Risultato
- Su desktop, il pannello condiviso ha la stessa altezza della scacchiera reale
- La chat non espande più il layout
- Scrolla solo `.chat-messages`
- È possibile risalire ai messaggi precedenti mantenendo l'autoscroll sui nuovi messaggi
- Su mobile resta il layout impilato, con gestione separata dell'altezza chat


## Sessione 2026-03-31 — bug fixes

### Bug #1 — Backend crash on empty Groq response — FIXED
`main.py`: wrapped `get_coach_comment` call in `try/except RuntimeError`.
On failure: logs `[WARN /move] get_coach_comment failed: ...` and returns graceful fallback string to the frontend instead of crashing.

### Bug #2 — Coach responses occasionally truncated — FIXED
`groq_client.py`: raised `max_tokens` in `get_coach_comment` from 300 → 600.

### Bug #3 — Coach does not know the player's color — FIXED
Full-stack implementation of `player_color`:
- `main.py`: added `player_color: str = "white"` to `MoveRequest`; passed `player_color=req.player_color` to `get_coach_comment`
- `groq_client.py`: added `player_color` parameter; renamed FEN-derived locals to `mover_color`/`responder_color` to avoid shadowing; prepends `player_context` string to user message
- `backend/prompts/coach_comment.txt`: fully rewritten — coach addresses player as "you"/"your move", refers to opponent by color, max 3 sentences, no hollow praise, explains strategic concepts
- `frontend/app.js`: added `player_color: playerColor` to `POST /move` fetch body; added `board.flip()` in `startGame()` when playing black; added `setPlayerColor()` helper

### Bug #4 — Turn number font hard to read — FIXED
- `frontend/app.js`: split "Turn N" into two spans — `.coach-turn-word` ("Turn") and `.coach-turn-number` (the digit)
- `frontend/style.css`: `.coach-turn-label` becomes a flex container; `.coach-turn-word` keeps Cormorant Garamond + letter-spacing (recedes as label); `.coach-turn-number` gets `font-size: 0.95rem`, `font-weight: 600`, `letter-spacing: 0`, brighter `--gold` (stands out as focal point)

### Difficulty slider audit
Confirmed that `skill_level` was already fully wired up in a prior session but not documented.
`getSkillLevel()` reads from `localStorage['chessSkillLevel']`; passed as `skill_level: getSkillLevel()` in every `POST /move` call.
Feature roadmap item #2 marked as done.

---

## Feature roadmap (pianificato 2026-03-30)

### Batch 1 — Backend/logica, nessuna modifica UI

#### 1. ~~Retry Groq su risposta vuota~~ ✓ DONE
Implementato in `groq_client.py`: loop da 3 tentativi con sleep da 0.5s tra i tentativi.
`main.py` gestisce anche il crash da `RuntimeError` con fallback graceful (vedi sessione 2026-03-31).

#### 2. ~~Livelli di difficoltà~~ ✓ DONE
Slider 0–20 nel setup overlay. `getSkillLevel()` legge da `localStorage`.
`skill_level: getSkillLevel()` è passato nel body di ogni `POST /move`. Confermato funzionante.
Implementato nella sessione 2026-03-29 ma non documentato in CLAUDE.md fino al 2026-03-31.

#### 3. Tono del coach più accessibile — PARZIALMENTE DONE
Il prompt `coach_comment.txt` è stato riscritto nella sessione 2026-03-31 per:
- Riferirsi al giocatore come "you"/"your move" e all'avversario per colore
- Tono diretto ma accessibile, con spiegazione dei concetti strategici
- Max 3 frasi, nessun incoraggiamento di maniera
Rimane aperto: rendere il coach ancora più progressivo/didattico per giocatori inesperti.

#### 4. ~~Undo — riporta indietro di un turno~~ ✓ DONE
`undoLastTurn()` in `app.js`: `game.undo()` × 2 + `board.position(game.fen())`.
Disabilitato se `game.history().length < 2` o durante chiamate async. Bottone `#btn-undo` presente.

#### 5. ~~Analisi del turno completo (bianco + nero)~~ ✓ DONE
Il coach riceve entrambe le mosse (giocatore + engine) in ogni commento.
`POST /move` restituisce `engine_move`; `addCoachMessage` riceve `turnInfo` con entrambe le notazioni.

---

### Batch 2 — UI e frontend (da fare con plugin frontend-design attivo)

#### 6. ~~Rappresentazione grafica nella bolla del coach~~ ✓ DONE
Implementato: `.coach-turn-header` con turno, notazione bianco/nero, divisore.
Stile del numero turno migliorato nella sessione 2026-03-31 (vedi sotto).

#### 7. ~~Traduzione UI in inglese~~ ✓ DONE (2026-03-29)

All visible frontend text (buttons, placeholders, system messages, setup overlay) translated to English.

---

### Ordine di implementazione aggiornato

- ~~1. Retry Groq~~ ✓
- ~~2. Livelli di difficoltà~~ ✓
- 3. Tono coach più accessibile (ancora migliorabile)
- ~~4. Undo~~ ✓
- ~~5. Analisi turno completo~~ ✓
- ~~6. Rappresentazione grafica bolla~~ ✓
- ~~7. Traduzione UI in inglese~~ ✓


---

## Ideas backlog

### ELO-based player rating system
Track the player's estimated ELO based on game results against Stockfish at different skill levels.
- Stockfish has a known approximate ELO per skill level — use it as the opponent rating in the ELO formula
- Save game results (win/loss/draw) and computed rating in localStorage
- Only count games above a minimum move threshold as valid
- Future option: let the player manually input their chess.com/lichess ELO as a starting point,
  then let the system adjust automatically based on results


### ~~Contextual chat with the coach~~ ✓ DONE (sessione 2026-03-31 — round 2)
See "Coaching refactor" section below. POST /chat endpoint implemented with full context (FEN, move log, prior analysis, conversation history). Chat available from game start.


---

## Bug / improvements found during testing (2026-03-30)

### 1. ~~Backend crash on empty Groq response~~ — FIXED (2026-03-31)

`main.py` now catches `RuntimeError` from `get_coach_comment` and returns a graceful fallback string.

### 2. ~~Coach responses occasionally truncated~~ — FIXED (2026-03-31)

`max_tokens` raised to 600 in `get_coach_comment`.

### 3. ~~Coach does not know the player's color~~ — FIXED (2026-03-31)

`player_color` passed through the full stack. Coach addresses player as "you/your move".

### 4. ~~Turn number font hard to read~~ — FIXED (2026-03-31)

"Turn N" split into two spans: `.coach-turn-word` (tracked Cormorant) + `.coach-turn-number` (larger, weight 600, no tracking, brighter gold).

### 5. Stockfish level 3 still too strong for a ~200 ELO player

No easy fix — Stockfish's floor is inherently around 1100 ELO. Low priority. Possible future approach: artificial blunders or move randomization at very low skill levels.

---

## Click-to-move + drag-and-drop highlights (sessione 2026-03-31)

Both input modes are active simultaneously at all times — no toggle.

### Click-to-move (onSquareClick)

- First click on own piece: selects it (`selectedSquare = square`), highlights it and its legal targets
- Second click on a legal target square: calls `executeMove(selectedSquare, square)`
- Second click on another own piece: switches selection (clears old highlights, selects new piece)
- Second click on invalid square: deselects (`clearHighlights(); selectedSquare = null`)
- `onSquareClick` registered in the ChessBoard config alongside `onDragStart`/`onDrop`

### Drag-and-drop highlights

- `onDragStart`: after all guard checks, calls `clearHighlights()` + `highlightSquare(source, 'highlight-selected')` + `highlightLegalMoves(source)`
- `onSnapbackEnd` (new): calls `clearHighlights(); selectedSquare = null` when a dragged piece snaps back

### Move execution refactor

- `executeMove(from, to)` extracted from `onDrop`: starts with `clearHighlights(); selectedSquare = null`, then runs all move validation + fetch logic
- `onDrop` now just calls `return executeMove(source, target)`

### Highlight CSS classes (style.css)

- `.highlight-selected`: gold tint background (`rgba(201,168,102,0.45)`)
- `.highlight-move::after`: small centered dot (32% circle, rgba black)
- `.highlight-capture::after`: ring via `box-shadow: inset 0 0 0 5px rgba(0,0,0,0.22)`

### State reset points

`clearHighlights()` and `selectedSquare = null` are called on:

- Move executed (start of `executeMove`)
- Snapback (in `onSnapbackEnd`)
- Undo (`undoLastTurn`)
- Game start (`startGame`)

---

## Dynamic piece symbols in coach headers + prompt rewrite (sessione 2026-03-31)

### `getPieceSymbol(san, color)` — `frontend/app.js`

New helper added just above `addMessage`. Derives the correct Unicode chess symbol from a SAN string and a color string (`'white'` or `'black'`).

- Reads the first character of `san`; if it's in `KQRBN` it's a piece letter, otherwise it's a pawn.
- Returns from a two-color lookup table of Unicode symbols (♔♕♖♗♘♙ / ♚♛♜♝♞♟).
- `addCoachMessage` now calls `getPieceSymbol(turnInfo.whiteMove, 'white')` and `getPieceSymbol(turnInfo.blackMove, 'black')` instead of hardcoded ♙/♟.

### Prompt rewrites

**`backend/prompts/coach_comment.txt`** — more concept-focused and didactic:

- When the player's move was a mistake, the coach now explicitly names the strategic concept violated (e.g. "this cedes center control", "this leaves your king exposed").
- When the move was strong, a brief acknowledgment is followed by a forward-looking plan or idea.
- Added explicit instruction to suggest a concrete plan for the next few moves when relevant.
- Added instruction to explain *why* something matters — not just what happened.

**`backend/prompts/hint_comment.txt`** — more specific and actionable:

- Added explicit instruction to name a piece that is poorly placed/inactive, or a weakness to target.
- Replaced "point to a strategic theme or area" with "be specific and useful: a concrete nudge, not a vague observation".

---

## Coaching refactor (sessione 2026-03-31 — round 2)

### Chat panel split

`.chat-section` is now a flex column with two children between the header and footer:

| Zone | Element | Behaviour |
|---|---|---|
| Analysis zone | `#analysis-zone` `.analysis-zone` | `flex: 0 0 auto`; always fully visible; content replaced on every turn via `addCoachMessage()`; shows placeholder when empty |
| Chat zone | `#chat-zone` `.chat-zone` | `flex: 1; min-height: 0; overflow-y: auto`; scrollable; accumulates hints, user messages, coach replies; cleared on every new analysis and on undo |

`#chat-messages` removed. `addMessage()` targets `#chat-zone`. `addCoachMessage()` targets `#analysis-zone` and replaces content (does not append). `syncLayout()` subtracts `analysisZone.offsetHeight` when computing chat-zone height.

### Per-turn context model

| Event | Analysis zone | Chat zone | `currentCoachAnalysis` | `currentTurnChatHistory` |
|---|---|---|---|---|
| `startGame()` / `startSetup()` | placeholder | clear | `""` | `[]` |
| POST /move response | replace with analysis | clear | set | `[]` |
| Hint response | unchanged | append coach message | unchanged | unchanged |
| User sends message | unchanged | append user + coach reply | unchanged | append both on success |
| `undoLastTurn()` | placeholder | clear | `""` | `[]` |

`resetChatState()` helper encapsulates the reset. Called from `startSetup()`, `startGame()`, and `undoLastTurn()`.

### New state vars (`app.js`)

- `currentCoachAnalysis: string` — set on each POST /move response; cleared on undo/new game
- `currentTurnChatHistory: Array<{role: 'user'|'coach', text: string}>` — cleared on new analysis and undo; passed to POST /chat

### Chat available from game start

The chat input is active as soon as a game starts (no longer gated on first move). POST /chat handles empty `coach_analysis` and empty `move_log` gracefully.

### POST /move — updated

`MoveRequest` now includes `move_log: str = ""`. Passed to `get_coach_comment()` and included in the Groq user message. `context` parameter removed from `get_coach_comment`. `max_tokens` lowered 600 → 180. Prompt: max 2 sentences, no follow-up.

### POST /chat — new endpoint

```
POST /chat
Body: { fen, move_log, coach_analysis, chat_history, message }
Response: { reply }
```

`get_chat_reply()` in `groq_client.py`: appends previous `chat_history` entries (role `"coach"` → `"assistant"`), injects context (FEN, move_log, coach_analysis) into the current user message. System prompt: `backend/prompts/chat_reply.txt`. `max_tokens`: 300. Sync `def`, not async.

### POST /hint — frontend change only

`addMessage(data.hint, 'coach')` now routes to `#chat-zone` automatically (no code change needed beyond the `addMessage` target update).
