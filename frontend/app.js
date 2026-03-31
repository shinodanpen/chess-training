const BACKEND = 'http://localhost:8000';

// Common white opening moves for engine-first scenario (player plays black)
const WHITE_OPENINGS = ['e2e4', 'd2d4', 'c2c4', 'g1f3', 'b1c3'];

const PIECE_SETS = ['cburnett', 'staunty', 'merida', 'maestro', 'tatiana', 'california', 'riohacha'];

const BOARD_THEMES = [
  { id: 'classic',  label: 'Classic',  light: '#f0d9b5', dark: '#b58863' },
  { id: 'walnut',   label: 'Walnut',   light: '#dab882', dark: '#6b3a22' },
  { id: 'slate',    label: 'Slate',    light: '#adbbc4', dark: '#456070' },
  { id: 'midnight', label: 'Midnight', light: '#3a4055', dark: '#1a1e2e' },
];

let game = new Chess();
let board = null;
let isThinking = false;
let playerColor = 'white'; // 'white' | 'black'
let selectedSquare = null;
let currentCoachAnalysis = '';
let currentTurnChatHistory = [];

// ---- Highlight helpers ----

function highlightSquare(square, cls) {
  $('#board .square-' + square).addClass(cls);
}

function highlightLegalMoves(square) {
  game.moves({ square: square, verbose: true }).forEach(function(m) {
    var cls = game.get(m.to) ? 'highlight-capture' : 'highlight-move';
    highlightSquare(m.to, cls);
  });
}

function clearHighlights() {
  $('#board [class*="square-"]').removeClass('highlight-selected highlight-move highlight-capture');
}

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

// ---- Difficulty ----

function getSkillLevel() {
  var val = parseInt(localStorage.getItem('chessSkillLevel'), 10);
  return isNaN(val) ? 3 : Math.min(20, Math.max(0, val));
}

function getDifficultyInfo(level) {
  if (level <= 6)  return { name: 'Beginner',     color: '#7a9478' };
  if (level <= 13) return { name: 'Intermediate', color: '#c9a866' };
  if (level <= 17) return { name: 'Advanced',     color: '#c4703a' };
                   return { name: 'Unbeatable',   color: '#9e3030' };
}

function updateDifficultyDisplay(value) {
  var info = getDifficultyInfo(value);
  var pct = (value / 20 * 100).toFixed(2) + '%';

  document.getElementById('diff-value').textContent = value;
  document.getElementById('diff-name').textContent = info.name;

  var section = document.querySelector('.difficulty-section');
  section.style.setProperty('--diff-color', info.color);

  var slider = document.getElementById('skill-slider');
  slider.style.setProperty('--diff-color', info.color);
  slider.style.background =
    'linear-gradient(to right, ' + info.color + ' 0%, ' + info.color + ' ' + pct + ', #2a2a34 ' + pct + ', #2a2a34 100%)';
}

function initDifficultySlider() {
  var initial = getSkillLevel();
  var slider = document.getElementById('skill-slider');
  slider.value = initial;
  updateDifficultyDisplay(initial);

  slider.addEventListener('input', function() {
    var val = parseInt(this.value, 10);
    localStorage.setItem('chessSkillLevel', val);
    updateDifficultyDisplay(val);
  });
}

// ---- Piece set & board theme ----

function getPieceSet() {
  var val = localStorage.getItem('chessPieceSet');
  return PIECE_SETS.indexOf(val) !== -1 ? val : 'cburnett';
}

function getBoardTheme() {
  var val = localStorage.getItem('chessBoardTheme');
  return BOARD_THEMES.some(function(t) { return t.id === val; }) ? val : 'classic';
}

function getPieceThemeUrl(setName) {
  return 'lib/pieces/' + setName + '/{piece}.svg';
}

function applyBoardTheme(themeName) {
  var wrapper = document.getElementById('board');
  if (!wrapper) return;
  BOARD_THEMES.forEach(function(t) {
    wrapper.classList.remove('board-theme-' + t.id);
  });
  if (themeName !== 'classic') {
    wrapper.classList.add('board-theme-' + themeName);
  }
}

function setPieceSet(setName) {
  localStorage.setItem('chessPieceSet', setName);
  refreshAllSelectors();
  if (board) {
    var fen = game.fen();
    var orientation = board.orientation();
    initBoard(fen, orientation);
  }
}

function setBoardTheme(themeName) {
  localStorage.setItem('chessBoardTheme', themeName);
  applyBoardTheme(themeName);
  refreshAllSelectors();
}

// ---- Board init (shared) ----

function initBoard(fen, orientation) {
  if (board) {
    board.destroy();
    board = null;
  }

  var size = getBoardSize();
  document.getElementById('board').style.width = size + 'px';

  board = ChessBoard('board', {
    draggable: true,
    position: fen || 'start',
    orientation: orientation || 'white',
    pieceTheme: getPieceThemeUrl(getPieceSet()),
    onDragStart: onDragStart,
    onDrop: onDrop,
    onSnapEnd: onSnapEnd,
    onSnapbackEnd: onSnapbackEnd,
    onSquareClick: onSquareClick,
  });

  applyBoardTheme(getBoardTheme());
  syncLayout();
}

// ---- Settings panel ----

function buildSwatches(gridEl, rowEl) {
  var currentSet = getPieceSet();
  var currentTheme = getBoardTheme();

  function buildPieceGrid(el) {
    el.innerHTML = '';
    PIECE_SETS.forEach(function(setName) {
      var btn = document.createElement('button');
      btn.className = 'piece-set-btn' + (setName === currentSet ? ' active' : '');
      btn.textContent = setName;
      btn.addEventListener('click', function() {
        setPieceSet(setName);
      });
      el.appendChild(btn);
    });
  }

  function buildThemeRow(el) {
    el.innerHTML = '';
    BOARD_THEMES.forEach(function(theme) {
      var btn = document.createElement('button');
      btn.className = 'theme-swatch-btn' + (theme.id === currentTheme ? ' active' : '');
      btn.title = theme.label;

      var colors = document.createElement('div');
      colors.className = 'theme-swatch-colors';
      // 2x2 checkerboard: light dark / dark light
      [theme.light, theme.dark, theme.dark, theme.light].forEach(function(c) {
        var sq = document.createElement('div');
        sq.className = 'sq';
        sq.style.background = c;
        colors.appendChild(sq);
      });

      var name = document.createElement('div');
      name.className = 'theme-swatch-name';
      name.textContent = theme.label;

      btn.appendChild(colors);
      btn.appendChild(name);
      btn.addEventListener('click', function() {
        setBoardTheme(theme.id);
      });
      el.appendChild(btn);
    });
  }

  if (gridEl) buildPieceGrid(gridEl);
  if (rowEl)  buildThemeRow(rowEl);
}

function refreshAllSelectors() {
  buildSwatches(
    document.getElementById('settings-piece-grid'),
    document.getElementById('settings-theme-row')
  );
  buildSwatches(
    document.getElementById('setup-piece-grid'),
    document.getElementById('setup-theme-row')
  );
}

function openSettings() {
  refreshAllSelectors();
  document.getElementById('settings-panel').classList.remove('hidden');
  document.getElementById('settings-backdrop').classList.remove('hidden');
  document.getElementById('btn-gear').classList.add('active');
}

function closeSettings() {
  document.getElementById('settings-panel').classList.add('hidden');
  document.getElementById('settings-backdrop').classList.add('hidden');
  document.getElementById('btn-gear').classList.remove('active');
}

// ---- Setup flow ----

function startSetup() {
  document.getElementById('setup-overlay').classList.remove('hidden');
  document.getElementById('game-container').classList.add('hidden');
  closeSettings();
  game.reset();
  resetChatState();
  refreshAllSelectors();
}

function isStackedLayout() {
  return window.innerWidth <= 860;
}

function getBoardSize() {
  var header = document.querySelector('.app-header');
  var headerHeight = header ? header.offsetHeight : 56;

  if (isStackedLayout()) {
    var mobileWidth = window.innerWidth - 32;
    var mobileHeight = window.innerHeight - headerHeight - 340;
    return Math.max(240, Math.min(mobileWidth, mobileHeight, 460));
  }

  var desktopChatWidth = 300;
  var boardSidePadding = 48;
  var outerMargin = 32;
  var maxHeight = window.innerHeight - headerHeight - outerMargin;
  var maxWidth = window.innerWidth - desktopChatWidth - boardSidePadding - outerMargin;

  return Math.max(240, Math.min(maxHeight, maxWidth, 560));
}

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

function startGame(color) {
  playerColor = color;

  document.getElementById('setup-overlay').classList.add('hidden');
  document.getElementById('game-container').classList.remove('hidden');

  game.reset();
  resetChatState();
  clearHighlights();
  selectedSquare = null;

  initBoard('start', color);

  if (playerColor === 'black') {
    board.flip();
  }

  toggleButtons(false);

  if (color === 'white') {
    addMessage('You are White. Drag a piece to begin.', 'system');
  } else {
    addMessage('You are Black. The coach is opening\u2026', 'system');
    setTimeout(engineFirstMove, 700);
  }
}

function resign() {
  startSetup();
}

// ---- Engine first move (player chose black) ----

function engineFirstMove() {
  isThinking = true;
  toggleButtons(true);

  var opening = WHITE_OPENINGS[Math.floor(Math.random() * WHITE_OPENINGS.length)];
  var engineMove = game.move({ from: opening.slice(0, 2), to: opening.slice(2, 4), promotion: 'q' });

  if (engineMove) {
    board.position(game.fen());
    addMessage('The coach opens with ' + engineMove.san + '. Your move.', 'system');
  }

  isThinking = false;
  toggleButtons(false);
}

// ---- Board event handlers ----

function onDragStart(source, piece) {
  if (isThinking) return false;
  if (game.game_over()) return false;
  if (piece.search(playerColor === 'white' ? /^b/ : /^w/) !== -1) return false;
  if (game.turn() !== (playerColor === 'white' ? 'w' : 'b')) return false;
  clearHighlights();
  highlightSquare(source, 'highlight-selected');
  highlightLegalMoves(source);
  return true;
}

async function executeMove(from, to) {
  clearHighlights();
  selectedSquare = null;

  var preFen = game.fen();
  var move = game.move({ from: from, to: to, promotion: 'q' });
  if (move === null) return 'snapback';

  var playerSAN = move.san;
  var uciMove = move.from + move.to + (move.promotion || '');
  board.position(game.fen());

  if (game.game_over()) {
    handleGameOver();
    return;
  }

  isThinking = true;
  toggleButtons(true);

  try {
    var res = await fetch(BACKEND + '/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fen: preFen,
        move: uciMove,
        skill_level: getSkillLevel(),
        player_color: playerColor,
        move_log: game.history().join(' '),
      }),
    });

    if (!res.ok) {
      var err = await res.json().catch(function() { return {}; });
      addMessage('Server error: ' + (err.detail || res.status), 'system');
      game.undo();
      board.position(game.fen());
      return;
    }

    var data = await res.json();

    var em = data.engine_move;
    var engineMove = game.move({
      from: em.slice(0, 2),
      to: em.slice(2, 4),
      promotion: em[4] || 'q',
    });

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

  } catch (err) {
    addMessage('Cannot reach the server. Make sure the backend is running on localhost:8000.', 'system');
    game.undo();
    board.position(game.fen());
  } finally {
    isThinking = false;
    toggleButtons(false);
  }
}

async function onDrop(source, target) {
  return executeMove(source, target);
}

function onSnapEnd() {
  board.position(game.fen());
}

function onSnapbackEnd() {
  clearHighlights();
  selectedSquare = null;
}

function onSquareClick(square) {
  if (isThinking || game.game_over()) return;

  var piece = game.get(square);
  var currentTurn = game.turn();
  var playerTurn = (playerColor === 'white') ? 'w' : 'b';

  if (selectedSquare === null) {
    if (piece && piece.color === playerTurn && currentTurn === playerTurn) {
      selectedSquare = square;
      clearHighlights();
      highlightSquare(square, 'highlight-selected');
      highlightLegalMoves(square);
    }
    return;
  }

  var legalTargets = game.moves({ square: selectedSquare, verbose: true }).map(function(m) { return m.to; });

  if (legalTargets.indexOf(square) !== -1) {
    executeMove(selectedSquare, square);
  } else if (piece && piece.color === playerTurn && currentTurn === playerTurn) {
    clearHighlights();
    selectedSquare = square;
    highlightSquare(square, 'highlight-selected');
    highlightLegalMoves(square);
  } else {
    clearHighlights();
    selectedSquare = null;
  }
}

// ---- Hint ----

async function requestHint() {
  if (isThinking || game.game_over()) return;
  isThinking = true;
  toggleButtons(true);

  try {
    var res = await fetch(BACKEND + '/hint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen: game.fen() }),
    });

    if (!res.ok) {
      var err = await res.json().catch(function() { return {}; });
      addMessage('Error: ' + (err.detail || res.status), 'system');
      return;
    }

    var data = await res.json();
    addMessage(data.hint, 'coach');

  } catch (err) {
    addMessage('Cannot reach the server.', 'system');
  } finally {
    isThinking = false;
    toggleButtons(false);
  }
}

// ---- Chat ----

function getPieceSymbol(san, color) {
  var pieces = {
    white: { K: '\u2654', Q: '\u2655', R: '\u2656', B: '\u2657', N: '\u2658', P: '\u2659' },
    black: { K: '\u265a', Q: '\u265b', R: '\u265c', B: '\u265d', N: '\u265e', P: '\u265f' },
  };
  var firstChar = san ? san[0] : '';
  var type = 'KQRBN'.indexOf(firstChar) !== -1 ? firstChar : 'P';
  return pieces[color][type];
}

function addMessage(text, type) {
  var chatEl = document.getElementById('chat-zone');

  var msg = document.createElement('div');
  msg.className = 'message ' + type;

  var labels = { coach: 'Coach', user: 'You' };
  if (labels[type]) {
    var label = document.createElement('div');
    label.className = 'label';
    label.textContent = labels[type];
    msg.appendChild(label);
  }

  var content = document.createElement('div');
  content.textContent = text;
  msg.appendChild(content);

  chatEl.appendChild(msg);
  requestAnimationFrame(function() {
    chatEl.scrollTop = chatEl.scrollHeight;
  });
}

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

// ---- Game state ----

function handleGameOver() {
  var msg = 'Game over. ';
  if (game.in_checkmate()) {
    var winner = game.turn() === 'b' ? 'White' : 'Black';
    msg += 'Checkmate \u2014 ' + winner + ' wins.';
  } else if (game.in_stalemate()) {
    msg += 'Stalemate \u2014 draw.';
  } else if (game.in_draw()) {
    msg += 'Draw.';
  }
  addMessage(msg, 'system');
}

// ---- UI helpers ----

function toggleButtons(disabled) {
  ['btn-hint', 'btn-send', 'btn-new-game', 'btn-resign'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.disabled = disabled;
  });
  var undoBtn = document.getElementById('btn-undo');
  if (undoBtn) undoBtn.disabled = disabled || game.history().length < 2;
}

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

// ---- Event listeners ----

document.getElementById('btn-undo').addEventListener('click', undoLastTurn);

document.getElementById('btn-hint').addEventListener('click', requestHint);

document.getElementById('btn-new-game').addEventListener('click', startSetup);

document.getElementById('btn-resign').addEventListener('click', resign);

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

document.getElementById('chat-input').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') document.getElementById('btn-send').click();
});

document.querySelectorAll('.color-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    startGame(btn.dataset.color);
  });
});

document.getElementById('btn-gear').addEventListener('click', function() {
  var panel = document.getElementById('settings-panel');
  if (panel.classList.contains('hidden')) {
    openSettings();
  } else {
    closeSettings();
  }
});

document.getElementById('btn-settings-close').addEventListener('click', closeSettings);

document.getElementById('settings-backdrop').addEventListener('click', closeSettings);

window.addEventListener('resize', function() {
  if (board) {
    syncLayout();
  }
});

// ---- Start ----

initDifficultySlider();
refreshAllSelectors();
startSetup();
