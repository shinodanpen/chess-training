# chess-training — Stato del progetto

## Obiettivo
Applicazione web per allenarsi agli scacchi con feedback in tempo reale da un coach AI.

- Backend: FastAPI + Stockfish + Groq
- Frontend: vanilla HTML/CSS/JS, nessun build step
- Focus attuale: gameplay coaching, scenario/review mode, UX polish, affidabilita' del coach

## Nota manutenzione documentazione
Questa versione di `CLAUDE.md` e' stata consolidata da **Codex** il **2026-04-02**
dopo hardening progressivo del coach (`structured outputs`, guardrail di legalita', sanity check tattico in chat)
e prima del passaggio successivo verso un coach piu' engine-backed.

Questo file privilegia:
- stato corrente reale del codice
- flussi operativi e gotcha non ovvi
- backlog e problemi ancora aperti

La timeline storica precedente e' stata compressa per evitare ridondanza.

---

## Struttura del progetto

```text
chess-training/
|-- backend/
|   |-- main.py
|   |-- stockfish_bridge.py
|   |-- groq_client.py
|   `-- prompts/
|       |-- coach_comment.txt
|       |-- hint_comment.txt
|       |-- chat_reply.txt
|       `-- scenario_review.txt
|-- frontend/
|   |-- index.html
|   |-- style.css
|   |-- app.js
|   `-- lib/
|       |-- chessboard.js
|       |-- chessboard.css
|       `-- pieces/<setname>/*.svg
|-- docs/
|-- test-checklist.md
`-- CLAUDE.md
```

## Come avviare

### Backend
```bash
cd backend
python -m venv ../venv
..\venv\Scripts\activate
pip install fastapi uvicorn python-chess groq python-dotenv httpx
uvicorn main:app --reload
```

Richiede `backend/.env` con:
- `GROQ_API_KEY`
- `STOCKFISH_PATH`

### Frontend
Usare Live Server su porta `5500`, oppure:

```bash
cd frontend
python -m http.server 5500
```

Backend atteso su `http://localhost:8000`.

## Verifica rapida

### Flusso standard
1. Aprire setup overlay
2. Scegliere White o Black
3. Giocare una mossa
4. Verificare risposta engine + analisi coach + chat + hint + undo

### Flusso scenario
1. Aprire `Scenario / Review`
2. Costruire posizione custom
3. Validare
4. Verificare chat coach disponibile gia' in `scenario_ready`
5. Verificare `Analyze Position` e `Play From Here`

---

## Backend

### Dipendenze
`fastapi`, `uvicorn`, `python-chess`, `groq`, `python-dotenv`, `httpx`

### `stockfish_bridge.py`
Processo UCI aperto/chiuso per ogni chiamata tramite `python-chess`.

| Funzione | Parametri | Risultato |
|---|---|---|
| `get_best_move` | `fen, skill_level` | mossa UCI |
| `analyze_position` | `fen` | `{score, best_move, depth}` |
| `analyze_position_rich` | `fen, depth?, multipv?, approved_score_loss_cp?` | analisi ricca con shortlist candidate + `position_profile` |
| `get_hint` | `fen` | `{score, best_move, depth}` |
| `is_chat_move_sane` | `fen, san, max_score_loss_cp?` | controllo tattico rapido su una mossa concreta suggerita in chat |

Note:
- `analyze_position()` e `get_hint()` usano depth 20
- `score` e' `int` in centipawns oppure stringa `"mate N"`
- `analyze_position_rich()` usa `MultiPV` (default 3) e produce:
  - candidate moves con `score_loss_cp`
  - approved move shortlist
  - `facts`
  - `position_profile`
- `is_chat_move_sane()` usa una verifica piu' rapida (`depth 14`) e scarta mosse chat legali ma troppo inferiori alla migliore
- soglia attuale chat sanity: circa `140 cp` di perdita massima tollerata rispetto alla best line

### `groq_client.py`
Client Groq singleton.

- modello attuale di default: `openai/gpt-oss-120b`
- override possibili via env:
  - `GROQ_MODEL`
  - `GROQ_REASONING_EFFORT`
- helper `_uci_to_san()` per conversione UCI -> SAN
- hard cap server-side a 2 frasi per coach e scenario review
- board snapshot testuale derivato dal FEN per ridurre allucinazioni su pezzi/case
- structured outputs JSON in strict mode quando il modello lo supporta (`gpt-oss-20b`, `gpt-oss-120b`)
- coach/hint/review rendono testo finale a partire da campi strutturati (`sentence_1`, `sentence_2`, ecc.)
- `analysis` viene ora arricchita con `position_profile` deterministico lato backend
- chat puo' nominare una mossa concreta solo se:
  - e' dichiarata nel payload strutturato
  - e' legale nella posizione
  - appartiene alla approved shortlist dell'engine quando disponibile
  - supera il sanity check tattico di Stockfish

Funzioni principali:

| Funzione | Scopo |
|---|---|
| `get_coach_comment(fen, final_fen, player_move, analysis, engine_move, player_color, move_log)` | commento sull'intero turno |
| `get_chat_reply(fen, move_log, coach_analysis, chat_history, message)` | chat contestuale |
| `get_hint_comment(fen, analysis)` | hint strategico |
| `get_scenario_review(fen, analysis, player_color)` | review iniziale della posizione custom |

### Endpoint API (`backend/main.py`)

| Endpoint | Body | Risposta |
|---|---|---|
| `GET /health` | - | `{"status":"ok"}` |
| `POST /move` | `{fen, move, skill_level, player_color, move_log}` | `{engine_move, coach_comment, score}` |
| `POST /hint` | `{fen}` | `{hint}` |
| `POST /chat` | `{fen, move_log, coach_analysis, chat_history, message}` | `{reply}` |
| `POST /scenario/validate` | `{fen, player_color, opponent_elo}` | `{normalized_fen, skill_level, opponent_to_move}` |
| `POST /scenario/analyze` | `{fen, player_color}` | `{coach_comment, score}` |
| `POST /engine-move` | `{fen, skill_level}` | `{engine_move}` |

Comportamento chiave:
- `/move` analizza la **posizione pre-mossa**
- poi applica la mossa del giocatore
- poi ottiene la risposta engine
- poi costruisce anche il **final FEN** del turno completo
- il coach riceve snapshot pre-mossa + snapshot finale

### Prompt

| File | Ruolo |
|---|---|
| `coach_comment.txt` | analisi post-turno, max 2 frasi |
| `hint_comment.txt` | hint, max 2 frasi, no exact move |
| `chat_reply.txt` | chat libera contestuale |
| `scenario_review.txt` | review iniziale della posizione validata |

Vincoli attuali importanti:
- niente centipawns in output utente
- niente best move esplicita
- niente riferimenti a case/pezzi non presenti nei board snapshot forniti
- `coach_comment`, `hint`, `scenario_review`: niente mosse concrete in output utente
- `chat`: mosse concrete ammesse solo in casi controllati e validate lato backend

### Stato attuale del coach
Pipeline attuale:
1. backend valida FEN e legalita' delle mosse reali di gioco
2. Stockfish produce analisi base (`score`, `best_move`)
   - ora anche `analyze_position_rich()` con:
     - candidate moves (`MultiPV`)
     - approved move shortlist
     - hanging/pinned piece facts
     - `position_profile`
3. Groq riceve:
   - board snapshot
   - legal move list
   - engine candidate shortlist
   - deterministic `position_profile`
   - contesto turno / chat
   - istruzioni per structured JSON
4. backend valida il payload strutturato
5. se la chat suggerisce una mossa concreta:
   - check SAN parseable
   - check legalita'
   - check membership nella engine-approved shortlist
   - check tattico rapido via Stockfish
6. se qualcosa fallisce: fallback a guida strategica o fallback locale deterministic

Questo ha migliorato:
- niente mosse illegali o che attraversano pezzi
- meno allucinazioni su case/pezzi
- meno verbose drift dai reasoning models
- piu' grounding posizionale di base (fase, sviluppo, king safety, pawn structure, loose/pinned pieces)

Questo NON garantisce ancora:
- vera comprensione posizionale
- spiegazioni affidabili su tattiche sottili
- suggerimenti concreti sempre forti solo perche' legali e non immediatamente perdenti

---

## Frontend

### Librerie
| Libreria | Fonte | Note |
|---|---|---|
| jQuery 3.7.1 | cdnjs | richiesta da chessboard.js |
| chess.js 0.10.3 | cdnjs | logica partita |
| chessboard.js | `frontend/lib/` | locale, patched |

### Layout generale
- setup overlay iniziale
- game container con board a sinistra e coach/chat a destra
- chat panel diviso in:
  - `#analysis-zone`: analisi dell'ultimo turno o review scenario
  - `#chat-zone`: hint + chat libera

### `frontend/app.js` — stato attuale
State machine principale:
- `setup`
- `scenario_editor`
- `scenario_ready`
- `playing`

Tipi di sessione:
- `standard`
- `scenario`

Capacita' chiave gia' implementate:
- drag-and-drop + click-to-move insieme
- highlight mosse legali
- highlight ultima mossa (`from` + `to`)
- undo di un turno completo
- chat contestuale con cronologia per turno
- hint
- scelta difficulty standard
- piece set / board theme persistiti in `localStorage`

### Piece sets / themes
Piece sets disponibili:
- `cburnett` (default)
- `staunty`
- `merida`
- `maestro`
- `tatiana`
- `california`
- `riohacha`

Board themes:
- `classic`
- `walnut`
- `slate`
- `midnight`

Persistenza:
- `localStorage['chessPieceSet']`
- `localStorage['chessBoardTheme']`
- `localStorage['chessSkillLevel']`

---

## Stato attuale

### Standard mode
Flusso verificato manualmente:
- setup overlay
- scelta White/Black
- orientamento board corretto
- mossa giocatore
- risposta engine
- analisi coach
- hint
- chat libera
- undo
- new game / resign

### Scenario / Review Mode v1
Implementata e testata manualmente il `2026-04-01`.

Comportamento attuale:
- entry point da setup overlay tramite `Scenario / Review`
- editor parte da **board vuota**
- piazzamento pezzi tramite palette
- erase tool
- clear board
- reset to start
- scelta:
  - side to move
  - player color
  - opponent ELO
- `Validate Scenario` obbligatorio prima di usare coach/play
- dopo validazione: stato `scenario_ready`
  - board validata resta caricata
  - chat coach disponibile subito
  - azioni:
    - `Edit Scenario`
    - `Analyze Position`
    - `Play From Here`
- se nello scenario muove prima l'avversario:
  - appare `Let Opponent Move`
  - viene richiesta una sola mossa engine
  - l'analisi pre-play viene invalidata e rimossa

Undo scenario:
- disabilitato in `scenario_ready`
- se esiste solo la prima mezza-mossa dell'avversario, undo torna allo stato validato
- dopo un turno completo, undo riusa il comportamento standard

ELO simulato:
- range UI: `800`-`2200`
- mapping backend: `clamp(round((elo - 800) / 70), 0, 20)`

### Test manuali confermati
Confermati nel corso della sessione:
- regressioni standard principali OK
- scenario entry e scenario flows principali OK
- palette scenario con SVG reali OK
- coach meno incline a inventare case grazie ai board snapshot
- subtext del bottone scenario corretto

---

## Problemi aperti / follow-up

### 1. Ridondanza `New Game` vs `Resign`
Entrambi riportano al setup overlay.

Decisione di prodotto ancora aperta:
- tenere entrambi ma differenziare il comportamento
- oppure rimuoverne uno

### 2. Affidabilita' residua del coach
Situazione migliorata rispetto allo stato precedente grazie a:
- cambio modello
- structured outputs
- fallback deterministico
- board snapshot
- final board snapshot nel commento post-turno
- legal move grounding
- gating tattico delle mosse concrete in chat

Pero' resta una dipendenza LLM:
- il coach puo' ancora essere imperfetto
- serve osservazione continua durante test reali
- failure mode attuale principale: il coach puo' ancora proporre idee "plausibili" ma strategicamente o tatticamente inferiori se non passano per una shortlist engine-backed

### 3. Cap hard sull'area analisi
Gia' mitigato:
- truncation server-side
- `analysis-zone` con `max-height` e scroll

Da verificare ancora nel tempo:
- che nessun output anomalo ricomprima la chat in modo sgradevole

### 4. UX scenario v1 ancora minimale
Mancano ancora:
- FEN import
- FEN export
- PGN import con jump-to-move
- save/load scenari
- castling rights / en passant controls

### 5. Tono coach per principianti
Il coach e' piu' stabile e grounded, ma si puo' ancora rendere:
- piu' progressivo
- piu' didattico
- meno denso per utenti molto inesperti

---

## Prossime cose da fare

### Priorita' alta
- completare il resto del test checklist e correggere eventuali bug residui
- decidere il destino UX di `New Game` / `Resign`
- continuare a monitorare eventuali hallucinations del coach in partite piu' lunghe
- consolidare il primo passaggio verso coach engine-backed gia' implementato:
  - validare `position_profile` su partite reali
  - rifinire plan hints e soglie
  - controllare falsi positivi / negativi su shortlist chat

### Priorita' media
- aggiungere FEN import
- aggiungere FEN export
- aggiungere save/load scenario locale
- migliorare tono coach per principianti
- far derivare il testo del coach da facts strutturati invece che da impressioni libere del modello
- aggiungere ulteriori feature posizionali al `position_profile` (`main_issue`, `urgency`, weak squares, space, ecc.)

### Priorita' futura
- PGN import con jump-to-move
- language setting globale (UI + coach output)
- ELO-based player rating system
- simulazione engine piu' debole ai bassi livelli

---

## Backlog prodotto

### ELO-based player rating system
Idea ancora valida:
- stimare ELO del giocatore in base ai risultati
- usare il rating approssimato dell'avversario/engine come riferimento
- salvare dati in `localStorage`

### Scenario mode v2 possibili estensioni
- import FEN
- export FEN
- import PGN
- save/load
- controlli avanzati FEN

### Language setting
Supportare una preferenza lingua unica che copra:
- UI
- system messages
- coach analysis
- hint
- chat libera

### Coach engine-backed roadmap
Direzione concordata il `2026-04-02`:

Passo pragmatico immediato:
- completato:
  - `MultiPV` in `stockfish_bridge.py`
  - shortlist di mosse approvate dall'engine
  - candidate moves con delta di eval
  - hanging pieces
  - pinned pieces
  - gating chat sulla shortlist approvata
  - primo `position_profile` con:
    - phase
    - material
    - development
    - king safety
    - pawn structure
    - tactical flags
    - plan hints deterministici

Passi successivi possibili:
- phase-aware coaching (opening / middlegame / endgame)
- tags strutturati tipo `main_issue`, `plan`, `urgency`, `king_safety`
- eventuale tablebase in finale ridotto
- piu' output deterministico e meno "free reasoning" nel testo finale

---

## Gotcha importanti

- `chessboard.js` locale e' patched; non sostituirlo alla cieca con una CDN
- in scenario editor il board non e' draggable: il piazzamento e' click-to-place
- il coach post-turno ragiona su:
  - posizione pre-mossa
  - mossa giocatore
  - risposta engine
  - snapshot finale del turno
- la chat ora e' piu' strettamente filtrata del coach testuale:
  - una mossa concreta puo' essere respinta anche se il testo sembra ragionevole
  - il backend preferisce tornare a guida strategica piuttosto che mostrare una mossa tatticamente sospetta
- chat e hint dipendono dal FEN corrente, non da uno stato server-side
- scenario mode non conosce lo storico reale della posizione, solo la posizione corrente validata

---

## File chiave

- `backend/main.py`: endpoint FastAPI
- `backend/groq_client.py`: logica Groq, truncation, board snapshot, review scenario
- `backend/stockfish_bridge.py`: integrazione Stockfish
- `frontend/app.js`: state machine app + standard/scenario flows
- `frontend/style.css`: layout, analysis/chat split, scenario UI
- `frontend/index.html`: setup overlay, game layout, scenario panel
- `test-checklist.md`: checklist manuale di test

---

## Changelog sintetico recente

### 2026-04-01
- scenario/review mode v1 implementata
- black orientation fix
- click-to-move fix
- last-move highlights
- coach fallback hardening
- board snapshots per grounding LLM
- palette scenario passata a SVG reali
- `CLAUDE.md` consolidato e ripulito

### 2026-04-02
- backend spostato su `openai/gpt-oss-120b` di default
- structured outputs JSON strict mode per coach/hint/chat/review
- guardrail lato backend per legalita' delle mosse suggerite
- sanity check tattico Stockfish per le mosse concrete in chat
- implementato primo passaggio coach engine-backed:
  - `MultiPV`
  - approved move shortlist
  - `position_profile`
  - hanging/pinned piece facts
  - grounding aggiuntivo per coach/hint/chat/review

### 2026-03-31 e prima
- chat contestuale `/chat`
- split analysis/chat panel
- piece sets e board themes
- UI redesign
- undo full-turn
- coach player-aware
