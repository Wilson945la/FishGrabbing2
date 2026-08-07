(() => {
  'use strict';

  const SIZE = 4;
  const TILE = {
    0:'#46494c', 2:'#eee4da', 4:'#ede0c8', 8:'#f2b179', 16:'#f59563',
    32:'#f67c5f', 64:'#f65e3b', 128:'#edcf72', 256:'#edcc61', 512:'#edc850',
    1024:'#edc53f', 2048:'#edc22e'
  };

  let root, gridEl, tilesEl, scoreEl, bestEl, board, score, best, over, won, tiles, nextId;
  let sx = 0, sy = 0;

  function buildDOM(c) {
    root = document.createElement('div');
    root.className = 'g2048-wrap';
    best = Number(localStorage.getItem('g2048_best') || 0);
    root.innerHTML = `
      <div class="g2048-info">
        <div class="scores">
          <div class="g2048-score"><div class="lbl">分数</div><div class="val" id="g-score">0</div></div>
          <div class="g2048-score"><div class="lbl">最高</div><div class="val" id="g-best">${best}</div></div>
        </div>
        <button class="g2048-new" id="g-new">新游戏</button>
      </div>
      <div class="g2048-board" id="g-board">
        <div class="g2048-grid" id="g-grid"></div>
        <div class="g2048-tiles" id="g-tiles"></div>
      </div>`;
    c.appendChild(root);
    gridEl = root.querySelector('#g-grid');
    tilesEl = root.querySelector('#g-tiles');
    scoreEl = root.querySelector('#g-score');
    bestEl = root.querySelector('#g-best');

    gridEl.innerHTML = '';
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      const cell = document.createElement('div');
      cell.className = 'g2048-cell';
      gridEl.appendChild(cell);
    }

    const boardEl = root.querySelector('#g-board');
    boardEl.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; });
    boardEl.addEventListener('pointerup', (e) => {
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
      if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 'right' : 'left');
      else move(dy > 0 ? 'down' : 'up');
    });
    root.querySelector('#g-new').onclick = initGame;
  }

  function initGame() {
    board = Array.from({ length: SIZE }, () => new Array(SIZE).fill(0));
    score = 0; over = false; won = false; nextId = 1; tiles = [];
    tilesEl.innerHTML = '';
    updateScore();
    spawn(); spawn();
  }

  function cellPct(i) { return (i / SIZE * 100) + '%'; }

  function styleTile(el, v) {
    el.style.background = TILE[v] || '#3c3a32';
    el.style.color = v <= 4 ? '#776e65' : '#fff';
    el.style.fontSize = (v >= 1024 ? 20 : v >= 128 ? 22 : 26) + 'px';
  }
  function positionTile(el, r, c) {
    el.style.left = cellPct(c);
    el.style.top = cellPct(r);
  }

  function createTileEl(t) {
    const el = document.createElement('div');
    el.className = 'g2048-tile pop';
    el.textContent = t.v;
    styleTile(el, t.v);
    el.style.width = (100 / SIZE) + '%';
    el.style.height = (100 / SIZE) + '%';
    positionTile(el, t.r, t.c);
    tilesEl.appendChild(el);
    setTimeout(() => { el.classList.remove('pop'); }, 170);
    return el;
  }

  function tileAt(r, c) {
    for (const t of tiles) if (!t._dead && t.r === r && t.c === c) return t;
    return null;
  }

  function spawn() {
    const empty = [];
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (!board[r][c]) empty.push([r, c]);
    if (!empty.length) return;
    const [r, c] = empty[Math.floor(Math.random() * empty.length)];
    const v = Math.random() < 0.9 ? 2 : 4;
    board[r][c] = v;
    const t = { id: nextId++, r, c, v, merged: false, _dead: false, el: null };
    t.el = createTileEl(t);
    tiles.push(t);
  }

  function updateScore() {
    scoreEl.textContent = score;
    if (score > best) { best = score; bestEl.textContent = best; localStorage.setItem('g2048_best', best); }
  }

  function lineCoords(dir) {
    const lines = [];
    if (dir === 'left') {
      for (let r = 0; r < SIZE; r++) { const L = []; for (let c = 0; c < SIZE; c++) L.push([r, c]); lines.push(L); }
    } else if (dir === 'right') {
      for (let r = 0; r < SIZE; r++) { const L = []; for (let c = SIZE - 1; c >= 0; c--) L.push([r, c]); lines.push(L); }
    } else if (dir === 'up') {
      for (let c = 0; c < SIZE; c++) { const L = []; for (let r = 0; r < SIZE; r++) L.push([r, c]); lines.push(L); }
    } else {
      for (let c = 0; c < SIZE; c++) { const L = []; for (let r = SIZE - 1; r >= 0; r--) L.push([r, c]); lines.push(L); }
    }
    return lines;
  }

  function move(dir) {
    if (over) return;
    const lines = lineCoords(dir);
    const plan = [];   // 先规划，再统一提交，避免在 !moved 时污染方块状态
    let moved = false;
    for (const line of lines) {
      const onLine = line.map(([r, c]) => ({ r, c, t: tileAt(r, c) })).filter(o => o.t);
      let i = 0; const results = [];
      while (i < onLine.length) {
        const cur = onLine[i], nxt = onLine[i + 1];
        if (nxt && cur.t.v === nxt.t.v) { results.push({ survivor: cur.t, dead: nxt.t }); i += 2; }
        else { results.push({ survivor: cur.t, dead: null }); i++; }
      }
      for (let k = 0; k < results.length; k++) {
        const [nr, nc] = line[k];
        const res = results[k];
        const newV = res.dead ? res.survivor.v * 2 : res.survivor.v;
        // 合并（数值变化）即便位置不变，也算一次有效移动，必须提交
        if (res.survivor.r !== nr || res.survivor.c !== nc || res.dead) moved = true;
        plan.push({ survivor: res.survivor, dead: res.dead, nr, nc, newV });
      }
    }
    if (!moved) return;

    // 统一提交：更新存活方块，并记录被吃掉的方块
    const deadTiles = [];
    for (const p of plan) {
      p.survivor.r = p.nr; p.survivor.c = p.nc;
      p.survivor.v = p.newV;
      p.survivor.merged = !!p.dead;
      if (p.dead) {
        p.dead._dead = true; p.dead.r = p.nr; p.dead.c = p.nc;
        if (!deadTiles.includes(p.dead)) deadTiles.push(p.dead);
      }
    }

    // 用存活方块重建棋盘
    board = Array.from({ length: SIZE }, () => new Array(SIZE).fill(0));
    for (const t of tiles) if (!t._dead) board[t.r][t.c] = t.v;
    for (const t of deadTiles) score += t.v * 2;
    updateScore();

    // 立即渲染：所有方块平滑滑到新位置（过渡动画）
    for (const t of tiles) positionTile(t.el, t.r, t.c);

    // 动画结束后：移除被吃掉的方块、更新合并方块的数值、生成新方块
    setTimeout(() => {
      for (const t of deadTiles) if (t.el && t.el.parentElement) t.el.parentElement.removeChild(t.el);
      tiles = tiles.filter(t => !t._dead);
      for (const t of tiles) {
        if (t.merged) {
          t.el.textContent = t.v; styleTile(t.el, t.v);
          t.el.classList.remove('merged'); void t.el.offsetWidth; t.el.classList.add('merged');
          t.merged = false;
        }
      }
      spawn();
      checkEnd();
    }, 150);
  }

  function boardHas(v) {
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (board[r][c] === v) return true;
    return false;
  }
  function isOver() {
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (!board[r][c]) return false;
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      if (c < SIZE - 1 && board[r][c] === board[r][c + 1]) return false;
      if (r < SIZE - 1 && board[r][c] === board[r + 1][c]) return false;
    }
    return true;
  }
  function checkEnd() {
    if (!over && !won && boardHas(2048)) {
      won = true;
      if (!confirm('🎉 达成 2048！是否继续？')) over = true;
    }
    if (isOver()) { over = true; alert('游戏结束！\n最终分数：' + score); }
  }

  window.GameModules = window.GameModules || {};
  window.GameModules.game2048 = {
    mount(c) { buildDOM(c); initGame(); },
    unmount() {
      if (root && root.parentElement) root.parentElement.removeChild(root);
      root = null;
    }
  };
})();
