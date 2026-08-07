(() => {
  'use strict';

  const DIFF = {
    '初级': [9, 9, 10],
    '中级': [16, 16, 40],
    '高级': [16, 30, 99],
  };
  const CELL_PX = 44; // 固定大格子，可滚动
  const HIDDEN = 0, REVEALED = 1, FLAGGED = 2;
  const NUM_CLR = ['', '#1976d2', '#388e3c', '#d32f2f', '#1a237e', '#b71c1c', '#0097a7', '#212121', '#616161'];
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  let root, boardEl, mineLabel, timeLabel, flagBtn, state, mountEl;

  function layoutGrid() {
    if (!state) return;
    const grid = root.querySelector('#ms-grid');
    grid.style.gridTemplateColumns = `repeat(${state.C}, ${CELL_PX}px)`;
    grid.style.setProperty('--ms-cell', CELL_PX + 'px');
  }

  function buildDOM(c) {
    root = document.createElement('div');
    root.style.cssText = 'width:100%;display:flex;flex-direction:column;align-items:center;';
    root.innerHTML = `<div id="ms-menu" class="ms-diff"></div>
      <div id="ms-game" class="hidden" style="width:100%;display:flex;flex-direction:column;align-items:center;">
        <div class="ms-top">
          <span class="ms-stat" id="ms-mine">💣 0</span>
          <button class="ms-stat" id="ms-restart" style="border:none;cursor:pointer">🔄</button>
          <span class="ms-stat" id="ms-time">⏱ 00:00</span>
        </div>
        <div class="ms-tools">
          <button id="ms-flag" class="active">👆 翻开</button>
          <button id="ms-back">‹ 菜单</button>
        </div>
        <div class="ms-board-wrap"><div class="ms-grid" id="ms-grid"></div></div>
      </div>`;
    c.appendChild(root);
    state = null;
  }

  function showMenu() {
    root.querySelector('#ms-menu').classList.remove('hidden');
    root.querySelector('#ms-game').classList.add('hidden');
    const menu = root.querySelector('#ms-menu');
    menu.innerHTML = '';
    ['初级', '中级', '高级'].forEach((d) => {
      const b = document.createElement('button');
      b.textContent = `${d} (${DIFF[d][0]}×${DIFF[d][1]}, ${DIFF[d][2]}雷)`;
      b.addEventListener('click', () => startGame(d));
      menu.appendChild(b);
    });
  }

  function startGame(diffName) {
    const [R, C, M] = DIFF[diffName];
    state = {
      R, C, M, diff: diffName,
      board: [], st: [], flags: 0, over: false, won: false,
      started: false, t0: 0, timer: null, flagMode: false,
    };
    for (let r = 0; r < R; r++) { state.board.push(new Array(C).fill(0)); state.st.push(new Array(C).fill(HIDDEN)); }

    root.querySelector('#ms-menu').classList.add('hidden');
    root.querySelector('#ms-game').classList.remove('hidden');
    mineLabel = root.querySelector('#ms-mine');
    timeLabel = root.querySelector('#ms-time');
    flagBtn = root.querySelector('#ms-flag');
    flagBtn.classList.add('active');
    flagBtn.textContent = '👆 翻开';
    state.flagMode = false;
    mineLabel.textContent = `💣 ${M}`;
    timeLabel.textContent = '⏱ 00:00';

    buildGrid();
    bindTools();
  }

  function buildGrid() {
    const grid = root.querySelector('#ms-grid');
    grid.innerHTML = '';
    for (let r = 0; r < state.R; r++) {
      for (let c = 0; c < state.C; c++) {
        const cell = document.createElement('button');
        cell.className = 'ms-cell';
        cell.dataset.r = r; cell.dataset.c = c;
        cell.addEventListener('click', () => onCell(r, c));
        grid.appendChild(cell);
      }
    }
    layoutGrid();
  }

  function bindTools() {
    flagBtn.onclick = () => {
      state.flagMode = !state.flagMode;
      flagBtn.classList.toggle('active', state.flagMode);
      flagBtn.textContent = state.flagMode ? '🚩 插旗' : '👆 翻开';
    };
    root.querySelector('#ms-back').onclick = showMenu;
    root.querySelector('#ms-restart').onclick = () => startGame(state.diff);
  }

  function placeMines(safeR, safeC) {
    let p = 0;
    while (p < state.M) {
      const r = Math.floor(Math.random() * state.R);
      const c = Math.floor(Math.random() * state.C);
      if (state.board[r][c] === -1) continue;
      if (Math.abs(r - safeR) <= 1 && Math.abs(c - safeC) <= 1) continue; // 首点周围安全
      state.board[r][c] = -1; p++;
    }
    for (let r = 0; r < state.R; r++) for (let c = 0; c < state.C; c++) {
      if (state.board[r][c] === -1) continue;
      let ct = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < state.R && nc >= 0 && nc < state.C && state.board[nr][nc] === -1) ct++;
      }
      state.board[r][c] = ct;
    }
  }

  function startTimer() {
    state.started = true;
    state.t0 = Date.now();
    state.timer = setInterval(() => {
      if (!state.over) timeLabel.textContent = '⏱ ' + elapsed();
    }, 1000);
  }
  function elapsed() {
    const s = Math.floor((Date.now() - state.t0) / 1000);
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  function onCell(r, c) {
    if (state.over) return;
    if (state.st[r][c] === REVEALED) return;
    if (!state.started) { placeMines(r, c); startTimer(); }

    if (state.flagMode) {
      if (state.st[r][c] === HIDDEN) { state.st[r][c] = FLAGGED; state.flags++; }
      else if (state.st[r][c] === FLAGGED) { state.st[r][c] = HIDDEN; state.flags--; }
      mineLabel.textContent = `💣 ${state.M - state.flags}`;
      paint(r, c);
      return;
    }

    if (state.st[r][c] === FLAGGED) return;
    if (state.board[r][c] === -1) { boom(r, c); return; }
    reveal(r, c);
    checkWin();
    paintAll();
  }

  function reveal(r, c) {
    if (r < 0 || r >= state.R || c < 0 || c >= state.C) return;
    if (state.st[r][c] !== HIDDEN || state.board[r][c] === -1) return;
    state.st[r][c] = REVEALED;
    if (state.board[r][c] === 0) {
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++)
        if (dr || dc) reveal(r + dr, c + dc);
    }
  }

  function boom(r, c) {
    state.over = true;
    if (state.timer) clearInterval(state.timer);
    for (let i = 0; i < state.R; i++) for (let j = 0; j < state.C; j++)
      if (state.board[i][j] === -1) state.st[i][j] = REVEALED;
    paintAll();
    const cell = root.querySelector(`#ms-grid .ms-cell[data-r="${r}"][data-c="${c}"]`);
    if (cell) cell.classList.add('mine');
    setTimeout(() => alert('💥 踩到雷了！游戏结束'), 60);
  }

  function checkWin() {
    let hidden = 0;
    for (let r = 0; r < state.R; r++) for (let c = 0; c < state.C; c++)
      if (state.board[r][c] !== -1 && state.st[r][c] !== REVEALED) hidden++;
    if (hidden === 0 && !state.over) {
      state.over = true; state.won = true;
      if (state.timer) clearInterval(state.timer);
      setTimeout(() => alert('🎉 恭喜你赢了！用时 ' + elapsed()), 60);
    }
  }

  function paint(r, c) {
    const cell = root.querySelector(`#ms-grid .ms-cell[data-r="${r}"][data-c="${c}"]`);
    if (!cell) return;
    const s = state.st[r][c];
    cell.className = 'ms-cell' + (s === REVEALED ? ' revealed' : s === FLAGGED ? ' flag' : '');
    if (s === FLAGGED) { cell.textContent = '🚩'; }
    else if (s === REVEALED) {
      const v = state.board[r][c];
      cell.textContent = v > 0 ? v : '';
      if (v > 0) cell.style.color = NUM_CLR[v] || '#000';
    } else cell.textContent = '';
  }
  function paintAll() {
    for (let r = 0; r < state.R; r++) for (let c = 0; c < state.C; c++) paint(r, c);
  }

  window.GameModules = window.GameModules || {};
  window.GameModules.minesweeper = {
    mount(c) {
      mountEl = c;
      buildDOM(c);
      showMenu();
    },
    unmount() {
      if (state && state.timer) clearInterval(state.timer);
      if (root && root.parentElement) root.parentElement.removeChild(root);
      root = null; state = null; mountEl = null;
    }
  };
})();
