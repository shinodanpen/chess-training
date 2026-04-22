const BACKEND = 'http://localhost:8000';
const START_POSITION_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
const EMPTY_POSITION_FEN = '8/8/8/8/8/8/8/8';
const START_GAME_FEN = START_POSITION_FEN + ' w KQkq - 0 1';

const APP_MODES = {
  SETUP: 'setup',
  SCENARIO_EDITOR: 'scenario_editor',
  SCENARIO_READY: 'scenario_ready',
  PLAYING: 'playing',
};

const SESSION_KINDS = {
  STANDARD: 'standard',
  SCENARIO: 'scenario',
  RAPID: 'rapid',
};

const SETUP_MODES = {
  STANDARD: 'standard',
  RAPID: 'rapid',
};

const WHITE_OPENINGS = ['e2e4', 'd2d4', 'c2c4', 'g1f3', 'b1c3'];

const PIECE_SETS = ['cburnett', 'staunty', 'merida', 'maestro', 'tatiana', 'california', 'riohacha'];

const BOARD_THEMES = [
  { id: 'classic',  label: 'Classic',  light: '#f0d9b5', dark: '#b58863' },
  { id: 'walnut',   label: 'Walnut',   light: '#dab882', dark: '#6b3a22' },
  { id: 'slate',    label: 'Slate',    light: '#adbbc4', dark: '#456070' },
  { id: 'midnight', label: 'Midnight', light: '#3a4055', dark: '#1a1e2e' },
];

const SCENARIO_PIECES = [
  'wK', 'wQ', 'wR', 'wB',
  'wN', 'wP', 'bK', 'bQ',
  'bR', 'bB', 'bN', 'bP',
];

const PIECE_GLYPHS = {
  wK: '\u2654',
  wQ: '\u2655',
  wR: '\u2656',
  wB: '\u2657',
  wN: '\u2658',
  wP: '\u2659',
  bK: '\u265a',
  bQ: '\u265b',
  bR: '\u265c',
  bB: '\u265d',
  bN: '\u265e',
  bP: '\u265f',
};

const PIECE_NAMES = {
  wK: 'White King',
  wQ: 'White Queen',
  wR: 'White Rook',
  wB: 'White Bishop',
  wN: 'White Knight',
  wP: 'White Pawn',
  bK: 'Black King',
  bQ: 'Black Queen',
  bR: 'Black Rook',
  bB: 'Black Bishop',
  bN: 'Black Knight',
  bP: 'Black Pawn',
};

let game = new Chess();
let board = null;
let isThinking = false;
let appMode = APP_MODES.SETUP;
let sessionKind = SESSION_KINDS.STANDARD;
let setupMode = SETUP_MODES.STANDARD;
let playerColor = 'white';
let activeSkillLevel = 3;
let selectedSquare = null;
let currentCoachAnalysis = '';
let currentTurnChatHistory = [];
let lastMove = null;
let mousedownSquare = null;
let scenarioState = createDefaultScenarioState();

function createDefaultScenarioState() {
  return {
    editorPlacementFen: EMPTY_POSITION_FEN,
    sideToMove: 'white',
    playerColor: 'white',
    opponentElo: 1200,
    selectedTool: 'wK',
    validatedFen: '',
    mappedSkillLevel: 6,
    opponentToMove: false,
    introAnalysis: '',
    waitingForOpponentMove: false,
    opponentStartMoveApplied: false,
  };
}

function setStatus(message, active) {
  var spinner = document.getElementById('status-spinner');
  var text = document.getElementById('status-text');
  if (!spinner || !text) return;
  text.textContent = message;
  if (active) {
    spinner.classList.add('active');
    text.classList.add('active');
  } else {
    spinner.classList.remove('active');
    text.classList.remove('active');
  }
}

function setAnalysisPlaceholder(text) {
  var analysisZone = document.getElementById('analysis-zone');
  if (!analysisZone) return;
  analysisZone.innerHTML = '<p class="analysis-placeholder">' + text + '</p>';
}

function refreshSetupModeControls() {
  var subtitle = document.getElementById('setup-subtitle');
  var btnStandard = document.getElementById('btn-setup-standard');
  var btnRapid = document.getElementById('btn-setup-rapid');
  var difficultyHeader = document.getElementById('difficulty-header');
  var whiteNote = document.getElementById('setup-white-note');
  var blackNote = document.getElementById('setup-black-note');

  if (subtitle) {
    subtitle.textContent = setupMode === SETUP_MODES.RAPID
      ? 'Choose your color and strength for rapid play'
      : 'Choose your color to begin';
  }

  if (btnStandard) btnStandard.classList.toggle('active', setupMode === SETUP_MODES.STANDARD);
  if (btnRapid) btnRapid.classList.toggle('active', setupMode === SETUP_MODES.RAPID);
  if (difficultyHeader) {
    difficultyHeader.textContent = setupMode === SETUP_MODES.RAPID ? 'Rapid Strength' : 'Difficulty';
  }

  if (whiteNote) {
    whiteNote.textContent = 'Moves first';
  }

  if (blackNote) {
    blackNote.textContent = setupMode === SETUP_MODES.RAPID ? 'Responds to engine' : 'Responds to coach';
  }
}

function resetChatState(placeholderText) {
  setAnalysisPlaceholder(placeholderText || 'Analysis will appear after your first move.');

  var chatZone = document.getElementById('chat-zone');
  if (chatZone) chatZone.innerHTML = '';

  currentCoachAnalysis = '';
  currentTurnChatHistory = [];
}

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

function clearLastMoveHighlights() {
  $('#board [class*="square-"]').removeClass('highlight-lastmove-from highlight-lastmove-to');
  lastMove = null;
}

function applyLastMoveHighlights() {
  if (!lastMove) return;
  highlightSquare(lastMove.from, 'highlight-lastmove-from');
  highlightSquare(lastMove.to, 'highlight-lastmove-to');
}

function highlightLastMove(from, to) {
  lastMove = { from: from, to: to };
  $('#board [class*="square-"]').removeClass('highlight-lastmove-from highlight-lastmove-to');
  highlightSquare(from, 'highlight-lastmove-from');
  highlightSquare(to, 'highlight-lastmove-to');
}

function getSkillLevel() {
  var val = parseInt(localStorage.getItem('chessSkillLevel'), 10);
  return isNaN(val) ? 3 : Math.min(20, Math.max(0, val));
}

function getDifficultyInfo(level) {
  if (level <= 6)  return { name: 'Beginner',     color: '#7a9478' };
  if (level <= 13) return { name: 'Intermediate', color: '#c9a866' };
  if (level <= 17) return { name: 'Advanced',     color: '#c4703a' };
  return { name: 'Unbeatable', color: '#9e3030' };
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
    if (sessionKind === SESSION_KINDS.STANDARD) {
      activeSkillLevel = val;
    }
  });
}

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

function getBoardStateForReinit() {
  if (appMode === APP_MODES.SCENARIO_EDITOR && board) {
    return board.position();
  }
  return game.fen();
}

function setPieceSet(setName) {
  localStorage.setItem('chessPieceSet', setName);
  refreshAllSelectors();
  renderScenarioPalette();

  if (board) {
    var state = getBoardStateForReinit();
    var orientation = board.orientation();
    initBoard(state, orientation);
  }
}

function setBoardTheme(themeName) {
  localStorage.setItem('chessBoardTheme', themeName);
  applyBoardTheme(themeName);
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
    applyLastMoveHighlights();
  }

  var actualBoardSize = Math.round(boardEl.getBoundingClientRect().width) || requestedBoardSize;
  var mainPanel = document.querySelector('.main-panel');
  var chatSection = document.querySelector('.chat-section');
  var chatHeader = document.querySelector('.chat-header');
  var scenarioPanel = document.getElementById('scenario-panel');
  var chatFooter = document.getElementById('chat-footer');
  var analysisZone = document.getElementById('analysis-zone');
  var chatZone = document.getElementById('chat-zone');

  if (!mainPanel || !chatSection || !chatZone) return;

  if (isStackedLayout()) {
    mainPanel.style.height = '';
    mainPanel.style.maxHeight = '';
    chatSection.style.height = appMode === APP_MODES.SCENARIO_EDITOR ? '420px' : '300px';
    chatSection.style.maxHeight = chatSection.style.height;
  } else {
    mainPanel.style.height = actualBoardSize + 'px';
    mainPanel.style.maxHeight = actualBoardSize + 'px';
    chatSection.style.height = actualBoardSize + 'px';
    chatSection.style.maxHeight = actualBoardSize + 'px';
  }

  var chatAvailableHeight = chatSection.clientHeight
    - (chatHeader && !chatHeader.classList.contains('hidden') ? chatHeader.offsetHeight : 0)
    - (scenarioPanel && !scenarioPanel.classList.contains('hidden') ? scenarioPanel.offsetHeight : 0)
    - (analysisZone && !analysisZone.classList.contains('hidden') ? analysisZone.offsetHeight : 0)
    - (chatFooter && !chatFooter.classList.contains('hidden') ? chatFooter.offsetHeight : 0);

  chatZone.style.height = Math.max(chatAvailableHeight, 0) + 'px';
  chatZone.style.maxHeight = Math.max(chatAvailableHeight, 0) + 'px';
  chatZone.style.overflowY = 'auto';
  chatZone.style.overflowX = 'hidden';
  chatZone.scrollTop = chatZone.scrollHeight;
}

function initBoard(position, orientation) {
  if (board) {
    board.destroy();
    board = null;
  }

  mousedownSquare = null;

  var size = getBoardSize();
  document.getElementById('board').style.width = size + 'px';

  var isPlayableBoard = appMode === APP_MODES.PLAYING;

  board = ChessBoard('board', {
    draggable: isPlayableBoard,
    position: position || 'start',
    orientation: orientation || 'white',
    pieceTheme: getPieceThemeUrl(getPieceSet()),
    onDragStart: isPlayableBoard ? onDragStart : undefined,
    onDrop: isPlayableBoard ? onDrop : undefined,
    onSnapEnd: isPlayableBoard ? onSnapEnd : undefined,
    onSnapbackEnd: isPlayableBoard ? onSnapbackEnd : undefined,
  });

  applyBoardTheme(getBoardTheme());

  $('#board').off('.chessmove .scenarioedit');

  if (isPlayableBoard) {
    $('#board')
      .on('mousedown.chessmove', '[data-square]', function() {
        mousedownSquare = $(this).attr('data-square');
      })
      .on('mouseup.chessmove', '[data-square]', function() {
        var upSquare = $(this).attr('data-square');
        if (upSquare === mousedownSquare) {
          onSquareClick(upSquare);
        }
        mousedownSquare = null;
      });
  } else if (appMode === APP_MODES.SCENARIO_EDITOR) {
    $('#board').on('mouseup.scenarioedit', '[data-square]', function() {
      onScenarioSquareClick($(this).attr('data-square'));
    });
  }

  syncLayout();
}

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
  if (rowEl) buildThemeRow(rowEl);
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

function loadGameFromFen(fen) {
  game = new Chess();
  if (!fen || fen === START_GAME_FEN) {
    game.reset();
    return;
  }

  var loaded = game.load(fen);
  if (loaded === false) {
    throw new Error('Could not load FEN into chess.js');
  }
}

function getCurrentSkillLevel() {
  if (sessionKind === SESSION_KINDS.SCENARIO) return scenarioState.mappedSkillLevel;
  if (sessionKind === SESSION_KINDS.RAPID) return activeSkillLevel;
  return getSkillLevel();
}

function renderScenarioPalette() {
  var palette = document.getElementById('scenario-piece-palette');
  if (!palette) return;

  palette.innerHTML = '';

  SCENARIO_PIECES.forEach(function(pieceCode) {
    var btn = document.createElement('button');
    btn.className = 'scenario-piece-btn';
    btn.dataset.piece = pieceCode;

    var preview = document.createElement('img');
    preview.className = 'scenario-piece-preview';
    preview.src = getPieceThemeUrl(getPieceSet()).replace('{piece}', pieceCode);
    preview.alt = PIECE_NAMES[pieceCode];
    preview.draggable = false;

    var name = document.createElement('span');
    name.className = 'scenario-piece-name';
    name.textContent = PIECE_NAMES[pieceCode];

    btn.appendChild(preview);
    btn.appendChild(name);
    btn.addEventListener('click', function() {
      scenarioState.selectedTool = pieceCode;
      refreshScenarioControls();
    });

    palette.appendChild(btn);
  });
}

function setScenarioEditorStatus(message, type) {
  var el = document.getElementById('scenario-editor-status');
  if (!el) return;
  el.textContent = message || '';
  el.className = 'scenario-status';
  if (type) {
    el.classList.add('status-' + type);
  }
}

function updateScenarioInputs() {
  document.getElementById('scenario-elo-input').value = scenarioState.opponentElo;
}

function getColorLabel(color) {
  return color === 'black' ? 'Black' : 'White';
}

function getSideToMoveFromFen(fen) {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white';
}

function getScenarioPlacementFen() {
  if (appMode === APP_MODES.SCENARIO_EDITOR && board) {
    return board.fen();
  }
  if (scenarioState.validatedFen) {
    return scenarioState.validatedFen.split(' ')[0];
  }
  return scenarioState.editorPlacementFen;
}

function getScenarioFullFen() {
  return getScenarioPlacementFen() + ' ' + (scenarioState.sideToMove === 'black' ? 'b' : 'w') + ' - - 0 1';
}

function getScenarioPositionObject() {
  if (!board) return {};
  return board.position();
}

function getScenarioPrecheckError() {
  var position = getScenarioPositionObject();
  var whiteKings = 0;
  var blackKings = 0;

  Object.keys(position).forEach(function(square) {
    var piece = position[square];
    if (piece === 'wK') whiteKings++;
    if (piece === 'bK') blackKings++;
  });

  if (whiteKings !== 1) {
    return 'The scenario must contain exactly one White king.';
  }
  if (blackKings !== 1) {
    return 'The scenario must contain exactly one Black king.';
  }

  var invalidPawnSquare = Object.keys(position).find(function(square) {
    var piece = position[square];
    return (piece === 'wP' || piece === 'bP') && (square[1] === '1' || square[1] === '8');
  });

  if (invalidPawnSquare) {
    return 'Pawns cannot be placed on the first or eighth rank.';
  }

  var elo = parseInt(document.getElementById('scenario-elo-input').value, 10);
  if (isNaN(elo) || elo < 800 || elo > 2200) {
    return 'Opponent ELO must be between 800 and 2200.';
  }

  scenarioState.opponentElo = elo;
  scenarioState.editorPlacementFen = getScenarioPlacementFen();
  return '';
}

function refreshScenarioControls() {
  document.querySelectorAll('.scenario-piece-btn').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.piece === scenarioState.selectedTool);
  });

  document.getElementById('btn-scenario-erase').classList.toggle('active', scenarioState.selectedTool === 'erase');
  document.getElementById('btn-scenario-turn-white').classList.toggle('active', scenarioState.sideToMove === 'white');
  document.getElementById('btn-scenario-turn-black').classList.toggle('active', scenarioState.sideToMove === 'black');
  document.getElementById('btn-scenario-player-white').classList.toggle('active', scenarioState.playerColor === 'white');
  document.getElementById('btn-scenario-player-black').classList.toggle('active', scenarioState.playerColor === 'black');

  var readySummary = document.getElementById('scenario-ready-summary');
  if (readySummary) {
    if (scenarioState.validatedFen) {
      var playState = game && game.game_over()
        ? 'This validated position is already game over, so only analysis and chat are available.'
        : (scenarioState.opponentToMove
          ? 'The opponent moves first once the scenario starts.'
          : 'You move first when the scenario starts.');

      readySummary.textContent =
        'You are ' + getColorLabel(scenarioState.playerColor) +
        '. ' + getColorLabel(scenarioState.sideToMove) + ' is to move.' +
        ' Opponent ELO ' + scenarioState.opponentElo +
        ' maps to engine skill ' + scenarioState.mappedSkillLevel + '. ' +
        playState;
    } else {
      readySummary.textContent = '';
    }
  }

  var pendingSummary = document.getElementById('scenario-pending-summary');
  if (pendingSummary) {
    pendingSummary.textContent =
      'The live scenario has started from the validated position, and ' +
      getColorLabel(scenarioState.sideToMove) +
      ' moves first. Let the opponent play that move when you are ready.';
  }
}

function refreshScenarioPanel() {
  var chatSection = document.querySelector('.chat-section');
  var scenarioPanel = document.getElementById('scenario-panel');
  var editorView = document.getElementById('scenario-editor-view');
  var readyView = document.getElementById('scenario-ready-view');
  var pendingView = document.getElementById('scenario-pending-view');
  var analysisZone = document.getElementById('analysis-zone');
  var chatZone = document.getElementById('chat-zone');
  var chatFooter = document.getElementById('chat-footer');
  var gameToolsRow = document.getElementById('game-tools-row');

  var showEditor = appMode === APP_MODES.SCENARIO_EDITOR;
  var showReady = appMode === APP_MODES.SCENARIO_READY;
  var showPending = appMode === APP_MODES.PLAYING &&
    sessionKind === SESSION_KINDS.SCENARIO &&
    scenarioState.waitingForOpponentMove;
  var showScenarioPanel = showEditor || showReady || showPending;

  scenarioPanel.classList.toggle('hidden', !showScenarioPanel);
  editorView.classList.toggle('hidden', !showEditor);
  readyView.classList.toggle('hidden', !showReady);
  pendingView.classList.toggle('hidden', !showPending);

  analysisZone.classList.toggle('hidden', showEditor);
  chatZone.classList.toggle('hidden', showEditor);
  chatFooter.classList.toggle('hidden', showEditor);
  gameToolsRow.classList.toggle('hidden', showReady || showPending);
  chatSection.classList.toggle('chat-section--scenario-editor', showEditor);

  refreshScenarioControls();
  syncLayout();
}

function refreshControls() {
  var chatInput = document.getElementById('chat-input');
  var btnSend = document.getElementById('btn-send');
  var btnHint = document.getElementById('btn-hint');
  var btnUndo = document.getElementById('btn-undo');
  var btnNewGame = document.getElementById('btn-new-game');
  var btnResign = document.getElementById('btn-resign');
  var btnValidate = document.getElementById('btn-scenario-validate');
  var btnAnalyze = document.getElementById('btn-scenario-analyze');
  var btnPlay = document.getElementById('btn-scenario-play');
  var btnEdit = document.getElementById('btn-scenario-edit');
  var btnLetOpponent = document.getElementById('btn-scenario-let-opponent-move');
  var canChat = !isThinking && (appMode === APP_MODES.SCENARIO_READY || appMode === APP_MODES.PLAYING);
  var canUseGameTools = !isThinking &&
    appMode === APP_MODES.PLAYING &&
    !scenarioState.waitingForOpponentMove &&
    !game.game_over();

  chatInput.disabled = !canChat;
  btnSend.disabled = !canChat;
  btnHint.disabled = !canUseGameTools;

  var specialScenarioUndo = sessionKind === SESSION_KINDS.SCENARIO &&
    appMode === APP_MODES.PLAYING &&
    scenarioState.opponentStartMoveApplied &&
    game.history().length === 1;

  btnUndo.disabled = isThinking || !(specialScenarioUndo || game.history().length >= 2);
  btnNewGame.disabled = isThinking;
  btnResign.disabled = isThinking;

  btnValidate.disabled = isThinking || appMode !== APP_MODES.SCENARIO_EDITOR;
  btnAnalyze.disabled = isThinking || appMode !== APP_MODES.SCENARIO_READY;
  btnPlay.disabled = isThinking || appMode !== APP_MODES.SCENARIO_READY || game.game_over();
  btnEdit.disabled = isThinking || appMode !== APP_MODES.SCENARIO_READY;
  btnLetOpponent.disabled = isThinking || !(
    appMode === APP_MODES.PLAYING &&
    sessionKind === SESSION_KINDS.SCENARIO &&
    scenarioState.waitingForOpponentMove &&
    !game.game_over()
  );
}

function addMessage(text, type) {
  var chatEl = document.getElementById('chat-zone');
  if (!chatEl || chatEl.classList.contains('hidden')) return;

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

function getPieceSymbol(san, color) {
  var pieces = {
    white: { K: '\u2654', Q: '\u2655', R: '\u2656', B: '\u2657', N: '\u2658', P: '\u2659' },
    black: { K: '\u265a', Q: '\u265b', R: '\u265c', B: '\u265d', N: '\u265e', P: '\u265f' },
  };
  var firstChar = san ? san[0] : '';
  var type = 'KQRBN'.indexOf(firstChar) !== -1 ? firstChar : 'P';
  return pieces[color][type];
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

function startSetup() {
  appMode = APP_MODES.SETUP;
  sessionKind = SESSION_KINDS.STANDARD;
  setupMode = SETUP_MODES.STANDARD;
  playerColor = 'white';
  activeSkillLevel = getSkillLevel();
  scenarioState = createDefaultScenarioState();

  document.getElementById('setup-overlay').classList.remove('hidden');
  document.getElementById('game-container').classList.add('hidden');

  closeSettings();
  clearHighlights();
  clearLastMoveHighlights();
  selectedSquare = null;
  game.reset();
  resetChatState('Analysis will appear after your first move.');
  setStatus('Ready', false);
  setScenarioEditorStatus('', '');
  updateScenarioInputs();
  refreshAllSelectors();
  refreshSetupModeControls();
}

function beginPlayableSession(options) {
  sessionKind = options.sessionKind || SESSION_KINDS.STANDARD;
  appMode = APP_MODES.PLAYING;
  playerColor = options.playerColor || 'white';
  activeSkillLevel = options.skillLevel || getSkillLevel();

  document.getElementById('setup-overlay').classList.add('hidden');
  document.getElementById('game-container').classList.remove('hidden');

  closeSettings();
  clearHighlights();
  clearLastMoveHighlights();
  selectedSquare = null;

  loadGameFromFen(options.startingFen || START_GAME_FEN);
  initBoard(game.fen(), playerColor);
  refreshScenarioPanel();
  refreshControls();
}

function startStandardGame(color) {
  scenarioState.waitingForOpponentMove = false;
  scenarioState.opponentStartMoveApplied = false;
  beginPlayableSession({
    startingFen: START_GAME_FEN,
    playerColor: color,
    skillLevel: getSkillLevel(),
    sessionKind: SESSION_KINDS.STANDARD,
  });

  resetChatState('Analysis will appear after your first move.');

  if (color === 'white') {
    addMessage('You are White. Drag a piece to begin.', 'system');
  } else {
    addMessage('You are Black. The coach is opening\u2026', 'system');
    isThinking = true;
    setStatus('Coach opening...', true);
    refreshControls();
    setTimeout(engineFirstMove, 700);
  }
}

function startRapidGame(color) {
  scenarioState.waitingForOpponentMove = false;
  scenarioState.opponentStartMoveApplied = false;
  beginPlayableSession({
    startingFen: START_GAME_FEN,
    playerColor: color,
    skillLevel: getSkillLevel(),
    sessionKind: SESSION_KINDS.RAPID,
  });

  resetChatState('Rapid Play — no analysis. Ask the coach or request a hint anytime.');

  if (color === 'white') {
    addMessage('Rapid Play. You are White.', 'system');
  } else {
    addMessage('Rapid Play. You are Black.', 'system');
    isThinking = true;
    setStatus('Engine moving...', true);
    refreshControls();
    setTimeout(engineFirstMove, 700);
  }
}

function startScenarioEditor() {
  appMode = APP_MODES.SCENARIO_EDITOR;
  sessionKind = SESSION_KINDS.SCENARIO;
  playerColor = scenarioState.playerColor;

  document.getElementById('setup-overlay').classList.add('hidden');
  document.getElementById('game-container').classList.remove('hidden');

  closeSettings();
  clearHighlights();
  clearLastMoveHighlights();
  selectedSquare = null;

  try {
    loadGameFromFen(START_GAME_FEN);
  } catch (err) {
    game.reset();
  }

  resetChatState('Validate the scenario to unlock the coach chat and scenario actions.');
  initBoard(scenarioState.editorPlacementFen, playerColor);
  updateScenarioInputs();
  setScenarioEditorStatus('', '');
  refreshScenarioPanel();
  refreshControls();
}

function editValidatedScenario() {
  if (!scenarioState.validatedFen) return;
  scenarioState.editorPlacementFen = scenarioState.validatedFen.split(' ')[0];
  scenarioState.sideToMove = getSideToMoveFromFen(scenarioState.validatedFen);
  scenarioState.playerColor = playerColor;
  startScenarioEditor();
}

function resign() {
  startSetup();
}

async function engineFirstMove() {
  if (sessionKind === SESSION_KINDS.RAPID) {
    try {
      var rapidRes = await fetch(BACKEND + '/engine-move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fen: game.fen(),
          skill_level: getCurrentSkillLevel(),
        }),
      });

      if (rapidRes.ok) {
        var rapidData = await rapidRes.json();
        var rapidMoveUci = rapidData.engine_move;
        var rapidMove = game.move({
          from: rapidMoveUci.slice(0, 2),
          to: rapidMoveUci.slice(2, 4),
          promotion: rapidMoveUci[4] || 'q',
        });

        if (rapidMove) {
          board.position(game.fen());
          highlightLastMove(rapidMoveUci.slice(0, 2), rapidMoveUci.slice(2, 4));
          addMessage('Rapid Play. Opponent opens with ' + rapidMove.san + '. Your move.', 'system');
          isThinking = false;
          setStatus('Ready', false);
          refreshControls();
          return;
        }
      } else {
        var rapidErr = await rapidRes.json().catch(function() { return {}; });
        addMessage('Could not fetch the rapid opening move: ' + (rapidErr.detail || rapidRes.status) + '. Using a fallback opening.', 'system');
      }
    } catch (err) {
      addMessage('Could not reach the backend for the rapid opening move. Using a fallback opening.', 'system');
    }
  }

  var opening = WHITE_OPENINGS[Math.floor(Math.random() * WHITE_OPENINGS.length)];
  var engineMove = game.move({ from: opening.slice(0, 2), to: opening.slice(2, 4), promotion: 'q' });

  if (engineMove) {
    board.position(game.fen());
    highlightLastMove(opening.slice(0, 2), opening.slice(2, 4));
    addMessage(
      sessionKind === SESSION_KINDS.RAPID
        ? 'Rapid Play. Opponent opens with ' + engineMove.san + '. Your move.'
        : 'The coach opens with ' + engineMove.san + '. Your move.',
      'system'
    );
  }

  isThinking = false;
  setStatus('Ready', false);
  refreshControls();
}

function onScenarioSquareClick(square) {
  if (appMode !== APP_MODES.SCENARIO_EDITOR || isThinking) return;

  var position = board.position();
  if (scenarioState.selectedTool === 'erase') {
    delete position[square];
  } else {
    position[square] = scenarioState.selectedTool;
  }

  board.position(position, false);
  scenarioState.editorPlacementFen = board.fen();
  setScenarioEditorStatus('', '');
}

function onDragStart(source, piece) {
  if (appMode !== APP_MODES.PLAYING) return false;
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
  if (appMode !== APP_MODES.PLAYING) return 'snapback';

  clearHighlights();
  selectedSquare = null;

  var previousLastMove = lastMove ? { from: lastMove.from, to: lastMove.to } : null;
  var preFen = game.fen();
  var move = game.move({ from: from, to: to, promotion: 'q' });
  if (move === null) return 'snapback';

  var playerSAN = move.san;
  var uciMove = move.from + move.to + (move.promotion || '');
  board.position(game.fen());
  highlightLastMove(from, to);

  if (game.game_over()) {
    handleGameOver();
    refreshControls();
    return;
  }

  isThinking = true;
  setStatus(sessionKind === SESSION_KINDS.RAPID ? 'Engine moving...' : 'Analyzing...', true);
  refreshControls();

  try {
    if (sessionKind === SESSION_KINDS.RAPID) {
      var rapidRes = await fetch(BACKEND + '/engine-move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fen: game.fen(),
          skill_level: getCurrentSkillLevel(),
        }),
      });

      if (!rapidRes.ok) {
        var rapidErr = await rapidRes.json().catch(function() { return {}; });
        addMessage('Server error: ' + (rapidErr.detail || rapidRes.status), 'system');
        game.undo();
        board.position(game.fen());
        if (previousLastMove) {
          highlightLastMove(previousLastMove.from, previousLastMove.to);
        } else {
          clearLastMoveHighlights();
        }
        return;
      }

      var rapidData = await rapidRes.json();
      var rem = rapidData.engine_move;
      var rapidEngineMove = game.move({
        from: rem.slice(0, 2),
        to: rem.slice(2, 4),
        promotion: rem[4] || 'q',
      });

      if (rapidEngineMove) {
        board.position(game.fen());
        highlightLastMove(rem.slice(0, 2), rem.slice(2, 4));
        if (game.game_over()) handleGameOver();
      }

    } else {
      var res = await fetch(BACKEND + '/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fen: preFen,
          move: uciMove,
          skill_level: getCurrentSkillLevel(),
          player_color: playerColor,
          move_log: game.history().join(' '),
        }),
      });

      if (!res.ok) {
        var err = await res.json().catch(function() { return {}; });
        addMessage('Server error: ' + (err.detail || res.status), 'system');
        game.undo();
        board.position(game.fen());
        if (previousLastMove) {
          highlightLastMove(previousLastMove.from, previousLastMove.to);
        } else {
          clearLastMoveHighlights();
        }
        return;
      }

      var data = await res.json();
      var em = data.engine_move;
      var engineMove = game.move({
        from: em.slice(0, 2),
        to: em.slice(2, 4),
        promotion: em[4] || 'q',
      });

      scenarioState.waitingForOpponentMove = false;
      currentCoachAnalysis = data.coach_comment;
      scenarioState.introAnalysis = data.coach_comment;
      currentTurnChatHistory = [];
      document.getElementById('chat-zone').innerHTML = '';

      if (engineMove) {
        board.position(game.fen());
        highlightLastMove(em.slice(0, 2), em.slice(2, 4));
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
    }

  } catch (err) {
    addMessage('Cannot reach the server. Make sure the backend is running on localhost:8000.', 'system');
    game.undo();
    board.position(game.fen());
    if (previousLastMove) {
      highlightLastMove(previousLastMove.from, previousLastMove.to);
    } else {
      clearLastMoveHighlights();
    }
  } finally {
    isThinking = false;
    setStatus('Ready', false);
    refreshControls();
  }
}

function onDrop(source, target) {
  if (source === target) {
    onSquareClick(source);
    return 'snapback';
  }
  return executeMove(source, target);
}

function onSnapEnd() {
  board.position(game.fen());
}

function onSnapbackEnd(piece, sourceSquare) {
  if (sourceSquare !== selectedSquare) {
    clearHighlights();
    selectedSquare = null;
  }
}

function onSquareClick(square) {
  if (appMode !== APP_MODES.PLAYING) return;
  if (isThinking || game.game_over()) return;

  var piece = game.get(square);
  var currentTurn = game.turn();
  var playerTurn = playerColor === 'white' ? 'w' : 'b';

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

async function requestHint() {
  if (appMode !== APP_MODES.PLAYING) return;
  if (isThinking || game.game_over() || scenarioState.waitingForOpponentMove) return;

  isThinking = true;
  setStatus('Getting hint...', true);
  refreshControls();

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
    setStatus('Ready', false);
    refreshControls();
  }
}

async function validateScenario() {
  if (appMode !== APP_MODES.SCENARIO_EDITOR || isThinking) return;

  var localError = getScenarioPrecheckError();
  if (localError) {
    setScenarioEditorStatus(localError, 'error');
    return;
  }

  var fullFen = getScenarioFullFen();
  isThinking = true;
  setStatus('Validating...', true);
  refreshControls();
  setScenarioEditorStatus('Validating scenario...', '');

  try {
    var res = await fetch(BACKEND + '/scenario/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fen: fullFen,
        player_color: scenarioState.playerColor,
        opponent_elo: scenarioState.opponentElo,
      }),
    });

    if (!res.ok) {
      var err = await res.json().catch(function() { return {}; });
      setScenarioEditorStatus(err.detail || 'Scenario validation failed.', 'error');
      return;
    }

    var data = await res.json();

    scenarioState.validatedFen = data.normalized_fen;
    scenarioState.editorPlacementFen = data.normalized_fen.split(' ')[0];
    scenarioState.sideToMove = getSideToMoveFromFen(data.normalized_fen);
    scenarioState.mappedSkillLevel = data.skill_level;
    scenarioState.opponentToMove = data.opponent_to_move;
    scenarioState.introAnalysis = '';
    scenarioState.waitingForOpponentMove = false;
    scenarioState.opponentStartMoveApplied = false;

    playerColor = scenarioState.playerColor;
    loadGameFromFen(data.normalized_fen);
    appMode = APP_MODES.SCENARIO_READY;
    initBoard(game.fen(), playerColor);
    resetChatState('Use Analyze Position for a review, or Play From Here to begin the scenario.');
    addMessage('Scenario validated. You can ask the coach about this position now.', 'system');
    refreshScenarioPanel();
    setScenarioEditorStatus('', '');

  } catch (err) {
    setScenarioEditorStatus('Could not reach the backend to validate this scenario.', 'error');
  } finally {
    isThinking = false;
    setStatus('Ready', false);
    refreshControls();
  }
}

async function analyzeScenario() {
  if (appMode !== APP_MODES.SCENARIO_READY || isThinking || !scenarioState.validatedFen) return;

  isThinking = true;
  setStatus('Analyzing...', true);
  refreshControls();

  try {
    var res = await fetch(BACKEND + '/scenario/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fen: scenarioState.validatedFen,
        player_color: scenarioState.playerColor,
      }),
    });

    if (!res.ok) {
      var err = await res.json().catch(function() { return {}; });
      addMessage('Error: ' + (err.detail || res.status), 'system');
      return;
    }

    var data = await res.json();
    scenarioState.introAnalysis = data.coach_comment;
    currentCoachAnalysis = data.coach_comment;
    addCoachMessage(data.coach_comment, null);

  } catch (err) {
    addMessage('Could not analyze this scenario right now.', 'system');
  } finally {
    isThinking = false;
    setStatus('Ready', false);
    refreshControls();
  }
}

function playScenario() {
  if (isThinking) return;
  if (appMode !== APP_MODES.SCENARIO_READY || !scenarioState.validatedFen || game.game_over()) return;

  appMode = APP_MODES.PLAYING;
  sessionKind = SESSION_KINDS.SCENARIO;
  playerColor = scenarioState.playerColor;
  activeSkillLevel = scenarioState.mappedSkillLevel;
  scenarioState.waitingForOpponentMove = scenarioState.opponentToMove;
  scenarioState.opponentStartMoveApplied = false;

  loadGameFromFen(scenarioState.validatedFen);
  initBoard(game.fen(), playerColor);
  playerColor = scenarioState.playerColor;
  if (board) board.orientation(playerColor);

  if (scenarioState.introAnalysis) {
    currentCoachAnalysis = scenarioState.introAnalysis;
    addCoachMessage(scenarioState.introAnalysis, null);
  } else {
    currentCoachAnalysis = '';
    setAnalysisPlaceholder('Analysis will appear after your first move.');
  }

  if (scenarioState.waitingForOpponentMove) {
    addMessage('The scenario has started. Let the opponent make the first move when you are ready.', 'system');
  } else {
    addMessage('Scenario started. Your move.', 'system');
  }

  refreshScenarioPanel();
  refreshControls();
}

async function letOpponentMove() {
  if (
    isThinking ||
    appMode !== APP_MODES.PLAYING ||
    sessionKind !== SESSION_KINDS.SCENARIO ||
    !scenarioState.waitingForOpponentMove
  ) {
    return;
  }

  isThinking = true;
  setStatus('Engine moving...', true);
  refreshControls();

  try {
    var res = await fetch(BACKEND + '/engine-move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fen: game.fen(),
        skill_level: getCurrentSkillLevel(),
      }),
    });

    if (!res.ok) {
      var err = await res.json().catch(function() { return {}; });
      addMessage('Error: ' + (err.detail || res.status), 'system');
      return;
    }

    var data = await res.json();
    var move = game.move({
      from: data.engine_move.slice(0, 2),
      to: data.engine_move.slice(2, 4),
      promotion: data.engine_move[4] || 'q',
    });

    if (!move) {
      addMessage('The opponent move could not be applied to the board.', 'system');
      return;
    }

    board.position(game.fen());
    highlightLastMove(data.engine_move.slice(0, 2), data.engine_move.slice(2, 4));
    scenarioState.waitingForOpponentMove = false;
    scenarioState.opponentStartMoveApplied = true;
    currentCoachAnalysis = '';
    currentTurnChatHistory = [];
    setAnalysisPlaceholder('Analysis will appear after your first move.');

    if (scenarioState.introAnalysis) {
      addMessage('The position has changed, so the pre-play analysis is no longer current.', 'system');
    }

    addMessage(getColorLabel(getSideToMoveFromFen(scenarioState.validatedFen)) + ' begins with ' + move.san + '. Your move.', 'system');

    if (game.game_over()) {
      handleGameOver();
    }

  } catch (err) {
    addMessage('Could not fetch the opponent move from the backend.', 'system');
  } finally {
    isThinking = false;
    setStatus('Ready', false);
    refreshScenarioPanel();
    refreshControls();
  }
}

function restoreScenarioReadyState() {
  appMode = APP_MODES.SCENARIO_READY;
  scenarioState.waitingForOpponentMove = false;
  scenarioState.opponentStartMoveApplied = false;
  loadGameFromFen(scenarioState.validatedFen);
  initBoard(game.fen(), playerColor);

  if (scenarioState.introAnalysis) {
    currentCoachAnalysis = scenarioState.introAnalysis;
    addCoachMessage(scenarioState.introAnalysis, null);
  } else {
    currentCoachAnalysis = '';
    setAnalysisPlaceholder('Use Analyze Position for a review, or Play From Here to begin the scenario.');
  }

  currentTurnChatHistory = [];
  addMessage('Returned to the validated scenario.', 'system');
  refreshScenarioPanel();
  refreshControls();
}

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

function undoLastTurn() {
  if (isThinking) return;

  var specialScenarioUndo = sessionKind === SESSION_KINDS.SCENARIO &&
    appMode === APP_MODES.PLAYING &&
    scenarioState.opponentStartMoveApplied &&
    game.history().length === 1;

  if (specialScenarioUndo) {
    restoreScenarioReadyState();
    return;
  }

  if (game.history().length < 2) return;

  clearHighlights();
  clearLastMoveHighlights();
  selectedSquare = null;
  game.undo();
  game.undo();
  board.position(game.fen());
  resetChatState('Analysis will appear after your first move.');
  syncLayout();
  refreshControls();
}

function wireScenarioControls() {
  renderScenarioPalette();
  updateScenarioInputs();

  document.getElementById('btn-scenario-erase').addEventListener('click', function() {
    scenarioState.selectedTool = 'erase';
    refreshScenarioControls();
  });

  document.getElementById('btn-scenario-turn-white').addEventListener('click', function() {
    scenarioState.sideToMove = 'white';
    refreshScenarioControls();
  });

  document.getElementById('btn-scenario-turn-black').addEventListener('click', function() {
    scenarioState.sideToMove = 'black';
    refreshScenarioControls();
  });

  document.getElementById('btn-scenario-player-white').addEventListener('click', function() {
    scenarioState.playerColor = 'white';
    playerColor = 'white';
    if (board) initBoard(getBoardStateForReinit(), 'white');
    refreshScenarioPanel();
  });

  document.getElementById('btn-scenario-player-black').addEventListener('click', function() {
    scenarioState.playerColor = 'black';
    playerColor = 'black';
    if (board) initBoard(getBoardStateForReinit(), 'black');
    refreshScenarioPanel();
  });

  document.getElementById('scenario-elo-input').addEventListener('input', function() {
    scenarioState.opponentElo = parseInt(this.value, 10);
  });

  document.getElementById('btn-scenario-clear').addEventListener('click', function() {
    if (appMode !== APP_MODES.SCENARIO_EDITOR) return;
    board.clear(false);
    scenarioState.editorPlacementFen = board.fen();
    setScenarioEditorStatus('', '');
  });

  document.getElementById('btn-scenario-reset').addEventListener('click', function() {
    if (appMode !== APP_MODES.SCENARIO_EDITOR) return;
    board.start(false);
    scenarioState.editorPlacementFen = board.fen();
    scenarioState.sideToMove = 'white';
    setScenarioEditorStatus('', '');
    refreshScenarioControls();
  });

  document.getElementById('btn-scenario-back').addEventListener('click', startSetup);
  document.getElementById('btn-scenario-validate').addEventListener('click', validateScenario);
  document.getElementById('btn-scenario-edit').addEventListener('click', editValidatedScenario);
  document.getElementById('btn-scenario-analyze').addEventListener('click', analyzeScenario);
  document.getElementById('btn-scenario-play').addEventListener('click', playScenario);
  document.getElementById('btn-scenario-let-opponent-move').addEventListener('click', letOpponentMove);
}

document.getElementById('btn-undo').addEventListener('click', undoLastTurn);
document.getElementById('btn-hint').addEventListener('click', requestHint);
document.getElementById('btn-new-game').addEventListener('click', startSetup);
document.getElementById('btn-resign').addEventListener('click', resign);

document.getElementById('btn-send').addEventListener('click', async function() {
  var input = document.getElementById('chat-input');
  var text = input.value.trim();
  if (!text || isThinking) return;
  if (appMode !== APP_MODES.SCENARIO_READY && appMode !== APP_MODES.PLAYING) return;

  input.value = '';
  addMessage(text, 'user');

  isThinking = true;
  setStatus('Thinking...', true);
  refreshControls();

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
    setStatus('Ready', false);
    refreshControls();
  }
});

document.getElementById('chat-input').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') document.getElementById('btn-send').click();
});

document.querySelectorAll('.color-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    if (setupMode === SETUP_MODES.RAPID) {
      startRapidGame(btn.dataset.color);
    } else {
      startStandardGame(btn.dataset.color);
    }
  });
});

document.getElementById('btn-setup-standard').addEventListener('click', function() {
  setupMode = SETUP_MODES.STANDARD;
  refreshSetupModeControls();
});

document.getElementById('btn-setup-rapid').addEventListener('click', function() {
  setupMode = SETUP_MODES.RAPID;
  refreshSetupModeControls();
});

document.getElementById('btn-scenario-mode').addEventListener('click', startScenarioEditor);

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

initDifficultySlider();
refreshAllSelectors();
wireScenarioControls();
startSetup();
