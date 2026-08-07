(() => {
  'use strict';

  const COLS = 10, ROWS = 20;
  let CELL = 24; // 动态计算，自适应屏幕
  const SHAPES = [
    [[1,1,1,1]],
    [[1,1],[1,1]],
    [[0,1,0],[1,1,1]],
    [[1,0,0],[1,1,1]],
    [[0,0,1],[1,1,1]],
    [[0,1,1],[1,1,0]],
    [[1,1,0],[0,1,1]],
  ];
  const COLORS = ['#00f0f0','#f0f000','#a000f0','#0000f0','#f0a000','#00f000','#f00000'];
  const STACK_BLOCKS = [
    {w:2,h:1},{w:3,h:1},{w:4,h:1},{w:2,h:2},{w:1,h:1},{w:3,h:2},{w:1,h:2}
  ];
  const STACK_COLORS = COLORS.slice();
  const BOARD_BASE = 200, BOARD_ROWS = 400;
  const w2b = (wr) => wr + BOARD_BASE;
  const rndInt = (n) => Math.floor(Math.random() * n);
  const clone = (s) => s.map(r => r.slice());

  let root, canvas, ctx, nextCanvas, nextCtx, scoreEl, linesEl, statusEl, mountEl;
  let mode = 'classic';
  // 经典/困难
  let board, cur, curX, curY, curType, nextType, score, lines, over, paused, timer, hardMode;
  // 叠叠乐
  let sboard, placedBlocks, scur, moveDir, frameCount, sviewOffset, sscore, sover, spaused, stimer;

  // ============================ DOM ============================
  function buildDOM(c) {
    root = document.createElement('div');
    root.className = 'tet-layout';
    root.style.maxWidth = '460px';
    root.innerHTML = `
      <div id="t-menu" class="tet-menu">
        <h3 class="tet-menu-title">俄罗斯方块</h3>
        <button class="tet-mode-btn" data-mode="classic">经典模式</button>
        <button class="tet-mode-btn" data-mode="hard">困难模式</button>
        <button class="tet-mode-btn" data-mode="stack">叠叠乐模式</button>
        <p class="tet-menu-tip">经典/困难：左右移动·上旋转·点「落底」放下<br>叠叠乐：方块自动左右移动，点「落底」放下，重心失衡即结束</p>
      </div>
      <div id="t-game" class="hidden" style="display:flex;flex-direction:column;align-items:center;gap:10px;width:100%;position:relative;">
        <div class="tet-info">
          <div class="tet-box"><div class="lbl">分数</div><div class="val" id="t-score">0</div></div>
          <div class="tet-box tet-next"><div class="lbl">下一个</div><canvas id="t-next"></canvas></div>
          <div class="tet-box"><div class="lbl">行数</div><div class="val" id="t-lines">0</div></div>
        </div>
        <canvas id="t-canvas" class="tet-canvas"></canvas>
        <div class="tet-ctrl">
          <button id="t-left">‹</button>
          <button id="t-rot" style="display:none;">⟳</button>
          <button id="t-right">›</button>
          <button id="t-down">▽</button>
          <button id="t-drop" style="grid-column:span 2;">⤓ 落底</button>
          <button id="t-pause" class="tet-pause">暂停</button>
          <button id="t-back" class="tet-pause" style="grid-column:span 2;">← 返回选模式</button>
        </div>
        <div id="t-over" class="tet-over hidden">
          <div class="tet-over-card">
            <div class="tet-over-title" id="t-over-title">游戏结束</div>
            <div class="tet-over-score" id="t-over-score"></div>
            <button class="tet-over-btn" id="t-restart">再来一局</button>
            <button class="tet-over-btn tet-over-back" id="t-tomenu">返回选模式</button>
          </div>
        </div>
      </div>`;
    c.appendChild(root);

    canvas = root.querySelector('#t-canvas'); ctx = canvas.getContext('2d');
    nextCanvas = root.querySelector('#t-next'); nextCtx = nextCanvas.getContext('2d');
    scoreEl = root.querySelector('#t-score'); linesEl = root.querySelector('#t-lines');
    statusEl = root.querySelector('#t-pause');

    root.querySelectorAll('.tet-mode-btn[data-mode]').forEach(b => { b.onclick = () => startMode(b.dataset.mode); });
    root.querySelector('#t-back').onclick = () => { stopAll(); showMenu(); };

    root.querySelector('#t-left').onclick = () => {
      if (mode === 'stack') { if (!sover && !spaused) { scur.x = Math.max(0, scur.x - 1); sDraw(); } }
      else { if (!over && !paused) { move(-1); draw(); } }
    };
    root.querySelector('#t-right').onclick = () => {
      if (mode === 'stack') { if (!sover && !spaused) { scur.x = Math.min(COLS - scur.w, scur.x + 1); sDraw(); } }
      else { if (!over && !paused) { move(1); draw(); } }
    };
    root.querySelector('#t-down').onclick = () => { if (mode !== 'stack') { if (!over && !paused) step(); } };
    root.querySelector('#t-rot').onclick = () => { if (mode !== 'stack') { if (!over && !paused) { rotate(); draw(); } } };
    root.querySelector('#t-drop').onclick = () => {
      if (mode === 'stack') { if (!sover && !spaused) sDrop(); }
      else { if (!over && !paused) hardDrop(); }
    };
    root.querySelector('#t-pause').onclick = togglePause;
    root.querySelector('#t-restart').onclick = () => { hideOver(); startMode(mode); };
    root.querySelector('#t-tomenu').onclick = () => { hideOver(); stopAll(); showMenu(); };
    canvas.addEventListener('pointerdown', onSwipe);
  }

  function showMenu() {
    root.querySelector('#t-menu').classList.remove('hidden');
    root.querySelector('#t-game').classList.add('hidden');
    hideOver();
  }
  function hideMenu() {
    root.querySelector('#t-menu').classList.add('hidden');
    root.querySelector('#t-game').classList.remove('hidden');
  }
  function showOver(title, scoreText) {
    const o = root.querySelector('#t-over');
    root.querySelector('#t-over-title').textContent = title;
    root.querySelector('#t-over-score').textContent = scoreText || '';
    o.classList.remove('hidden');
  }
  function hideOver() {
    const o = root.querySelector('#t-over');
    if (o) o.classList.add('hidden');
  }
  function stopAll() { if (timer) clearInterval(timer); if (stimer) clearInterval(stimer); }

  // ============================ 自适应尺寸 ============================
  function fitCanvas() {
    const el = mountEl || root;
    // 容器可用宽度
    const availW = Math.min((el.clientWidth || 320) - 8, 460);
    // 容器可用高度：减去 info(~54px) + controls(~86px) + gaps(~24px)
    const elH = el.clientHeight || Math.max(320, window.innerHeight - 160);
    const availH = Math.max(180, elH - 164);
    // 根据宽高限制计算 cell
    let cell = Math.floor(Math.min(availW / COLS, availH / ROWS));
    cell = Math.max(12, Math.min(cell, 26));
    CELL = cell;
    const w = COLS * CELL, h = ROWS * CELL, dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const nw = 4 * CELL;
    nextCanvas.width = nw * dpr; nextCanvas.height = nw * dpr;
    nextCanvas.style.width = nw + 'px'; nextCanvas.style.height = nw + 'px';
    nextCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ============================ 经典 / 困难 ============================
  function reset() {
    board = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
    score = 0; lines = 0; over = false; paused = false;
    statusEl.textContent = '暂停';
    scoreEl.textContent = '0'; linesEl.textContent = '0';
    spawn();
  }
  function spawn() {
    curType = (nextType !== undefined) ? nextType : rndInt(SHAPES.length);
    cur = clone(SHAPES[curType]);
    nextType = rndInt(SHAPES.length);
    curX = Math.floor(COLS / 2 - cur[0].length / 2);
    curY = 0;
    drawNext();
    if (!canPlace(cur, curX, curY)) {
      over = true; if (timer) clearInterval(timer);
      draw();
      setTimeout(() => showOver('游戏结束', '最终分数：' + score), 60);
    }
  }
  function canPlace(shape, x, y) {
    for (let r = 0; r < shape.length; r++) for (let c = 0; c < shape[r].length; c++) {
      if (shape[r][c]) {
        const nx = x + c, ny = y + r;
        if (nx < 0 || nx >= COLS || ny >= ROWS) return false;
        if (ny >= 0 && board[ny][nx]) return false;
      }
    }
    return true;
  }
  function move(d) { if (canPlace(cur, curX + d, curY)) curX += d; }
  function rotate() {
    const rows = cur.length, cols = cur[0].length;
    const rot = Array.from({ length: cols }, () => new Array(rows).fill(0));
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) rot[c][rows - 1 - r] = cur[r][c];
    if (canPlace(rot, curX, curY)) cur = rot;
  }
  function step() {
    if (over || paused) return;
    if (canPlace(cur, curX, curY + 1)) curY++; else lock();
    draw();
  }
  function hardDrop() {
    if (over || paused) return;
    while (canPlace(cur, curX, curY + 1)) curY++;
    lock(); draw();
  }
  function lock() {
    for (let r = 0; r < cur.length; r++) for (let c = 0; c < cur[r].length; c++)
      if (cur[r][c]) { const ny = curY + r, nx = curX + c; if (ny >= 0) board[ny][nx] = curType + 1; }
    const cleared = clearLines();
    score += 1; if (cleared) score += cleared * 5;
    lines += cleared;
    scoreEl.textContent = score; linesEl.textContent = lines;
    spawn();
  }
  function clearLines() {
    let cleared = 0;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (board[r].every(v => v)) {
        cleared++;
        for (let rr = r; rr > 0; rr--) board[rr] = board[rr - 1].slice();
        board[0] = new Array(COLS).fill(0);
        r++;
      }
    }
    return cleared;
  }
  function togglePause() {
    if (mode === 'stack') { if (sover) return; spaused = !spaused; statusEl.textContent = spaused ? '继续' : '暂停'; return; }
    if (over) return;
    paused = !paused;
    if (paused) { if (timer) clearInterval(timer); statusEl.textContent = '继续'; }
    else { statusEl.textContent = '暂停'; timer = setInterval(step, 500); }
  }
  function fillCell(g, c, r, color) {
    g.fillStyle = color;
    g.fillRect(c * CELL + 1, r * CELL + 1, CELL - 2, CELL - 2);
  }
  function draw() {
    const w = COLS * CELL, h = ROWS * CELL;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#2a2d2f';
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) ctx.strokeRect(c * CELL, r * CELL, CELL, CELL);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++)
      if (board[r][c]) fillCell(ctx, c, r, COLORS[board[r][c] - 1]);
    // 困难模式：不显示当前下落方块
    if (cur && !hardMode) for (let r = 0; r < cur.length; r++) for (let c = 0; c < cur[r].length; c++)
      if (cur[r][c]) fillCell(ctx, curX + c, curY + r, COLORS[curType]);
    if (over) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.max(16, CELL*0.9)}px sans-serif`; ctx.textAlign = 'center';
      ctx.fillText('游戏结束', w / 2, h / 2);
    }
  }
  function drawNext() {
    const nw = 4 * CELL;
    nextCtx.clearRect(0, 0, nw, nw);
    const s = SHAPES[nextType];
    const offX = (4 - s[0].length) / 2, offY = (4 - s.length) / 2;
    for (let r = 0; r < s.length; r++) for (let c = 0; c < s[r].length; c++)
      if (s[r][c]) {
        nextCtx.fillStyle = COLORS[nextType];
        nextCtx.fillRect((offX + c) * CELL + 1, (offY + r) * CELL + 1, CELL - 2, CELL - 2);
      }
  }

  // ============================ 叠叠乐 ============================
  function sReset() {
    sboard = Array.from({ length: BOARD_ROWS }, () => new Array(COLS).fill(0));
    placedBlocks = []; sscore = 0; sviewOffset = 0; over = false; sover = false; spaused = false;
    moveDir = 1; frameCount = 0;
    sSpawn();
    stimer = setInterval(() => {
      if (!sover && !spaused) {
        frameCount++;
        if (frameCount % getMoveSpeed() === 0) sMoveHoriz();
        sDraw();
      }
    }, 16);
  }
  function sSpawn() {
    const type = rndInt(STACK_BLOCKS.length);
    scur = { type, w: STACK_BLOCKS[type].w, h: STACK_BLOCKS[type].h, color: STACK_COLORS[type], x: 0, y: 0 };
    moveDir = 1; frameCount = 0;
  }
  function sMoveHoriz() {
    scur.x += moveDir;
    if (scur.x + scur.w >= COLS) moveDir = -1;
    else if (scur.x <= 0) moveDir = 1;
  }
  function getMoveSpeed() { return Math.max(2, 16 - Math.floor(placedBlocks.length / 5)); }
  function findLandingY() {
    let topBlockBottom = ROWS;
    for (let r = -(BOARD_BASE - 1); r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) { if (sboard[w2b(r)][c] > 0) { topBlockBottom = r; r = ROWS; break; } }
    }
    const startY = Math.min(-(BOARD_BASE - scur.h - 1), topBlockBottom - scur.h - 2);
    for (let y = startY; y <= ROWS - scur.h; y++) {
      let collision = false;
      for (let r = 0; r < scur.h && !collision; r++) {
        for (let c = 0; c < scur.w && !collision; c++) {
          const br = y + r, bc = scur.x + c;
          if (br >= -BOARD_BASE && br < BOARD_ROWS - BOARD_BASE && bc >= 0 && bc < COLS && sboard[w2b(br)][bc] > 0) collision = true;
        }
      }
      if (collision) return y - 1;
    }
    return ROWS - scur.h;
  }
  function collectAbove(all, stack) {
    const next = [];
    for (const base of stack) {
      for (const pb of all) {
        if (stack.indexOf(pb) >= 0) continue;
        if (pb.y === base.y + base.h) {
          const overlaps = (pb.x + pb.w > base.x) && (pb.x < base.x + base.w);
          if (overlaps) next.push(pb);
        }
      }
    }
    for (const n of next) stack.push(n);
    if (next.length) collectAbove(all, stack);
  }
  function sDrop() {
    scur.y = findLandingY();
    if (placedBlocks.length) {
      const last = placedBlocks[placedBlocks.length - 1];
      const overlapsX = (scur.x + scur.w > last.x) && (scur.x < last.x + last.w);
      const touchingY = (scur.y + scur.h === last.y);
      if (!overlapsX || !touchingY) { sEnd(); return; }
    }
    const curBlock = { x: scur.x, y: scur.y, w: scur.w, h: scur.h, type: scur.type };
    const all = placedBlocks.slice(); all.push(curBlock);
    const layerLevels = new Set();
    for (const pb of all) layerLevels.add(pb.y + pb.h);
    for (const layerY of layerLevels) {
      let layerMin, layerMax;
      if (layerY >= ROWS) { layerMin = 0; layerMax = COLS; }
      else {
        layerMin = COLS; layerMax = 0;
        for (const pb of all) {
          if (pb.y + pb.h === layerY) { if (pb.x < layerMin) layerMin = pb.x; if (pb.x + pb.w > layerMax) layerMax = pb.x + pb.w; }
        }
      }
      const stack = [];
      for (const pb of all) if (pb.y === layerY) stack.push(pb);
      if (!stack.length) continue;
      collectAbove(all, stack);
      let tw = 0, tm = 0;
      for (const s of stack) { const w = s.w * s.h; tw += w; tm += w * (s.x + s.w / 2); }
      const cx = tm / tw;
      const margin = 0.5;
      if (cx < layerMin - margin || cx > layerMax + margin) { sEnd(); return; }
    }
    sLock(); sscore += 2; scoreEl.textContent = sscore;
    updateSView(); sSpawn(); sDraw();
  }
  function sLock() {
    placedBlocks.push({ x: scur.x, y: scur.y, w: scur.w, h: scur.h, type: scur.type });
    for (let r = 0; r < scur.h; r++) for (let c = 0; c < scur.w; c++) {
      const ny = scur.y + r, nx = scur.x + c;
      if (ny >= -BOARD_BASE && ny < BOARD_ROWS - BOARD_BASE && nx >= 0 && nx < COLS) sboard[w2b(ny)][nx] = scur.type + 1;
    }
  }
  function updateSView() {
    let topRow = ROWS;
    outer: for (let r = -(BOARD_BASE - 1); r < ROWS; r++)
      for (let c = 0; c < COLS; c++) { if (sboard[w2b(r)][c] > 0) { topRow = r; break outer; } }
    if (topRow >= ROWS) { sviewOffset = 0; return; }
    const threshold = 10;
    if (topRow >= threshold) { sviewOffset = 0; return; }
    sviewOffset = topRow - threshold;
  }
  function sEnd() {
    sover = true; if (stimer) clearInterval(stimer);
    statusEl.textContent = '失衡！';
    sDraw();
    setTimeout(() => showOver('失衡！游戏结束', '最终分数：' + sscore), 60);
  }
  function sDraw() {
    const w = COLS * CELL, h = ROWS * CELL;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#2a2d2f';
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) ctx.strokeRect(c * CELL, r * CELL, CELL, CELL);
    const groundScreen = (ROWS - 1) - sviewOffset;
    if (groundScreen >= -1 && groundScreen < ROWS + 1) {
      ctx.fillStyle = '#00b400'; ctx.fillRect(0, (groundScreen + 1) * CELL - 2, w, 3);
    }
    for (let wr = -(BOARD_BASE - 1); wr < BOARD_ROWS - BOARD_BASE; wr++) {
      const sr = wr - sviewOffset;
      if (sr < 0 || sr >= ROWS) continue;
      for (let c = 0; c < COLS; c++) {
        if (sboard[w2b(wr)][c] > 0) {
          ctx.fillStyle = STACK_COLORS[sboard[w2b(wr)][c] - 1];
          ctx.fillRect(c * CELL + 1, sr * CELL + 1, CELL - 2, CELL - 2);
        }
      }
    }
    if (scur && !sover) {
      const gy = findLandingY();
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      for (let r = 0; r < scur.h; r++) for (let c = 0; c < scur.w; c++) {
        const sr = gy + r - sviewOffset;
        if (sr >= 0 && sr < ROWS) ctx.fillRect((scur.x + c) * CELL + 1, sr * CELL + 1, CELL - 2, CELL - 2);
      }
      ctx.fillStyle = scur.color;
      for (let r = 0; r < scur.h; r++) for (let c = 0; c < scur.w; c++) {
        const sr = scur.y + r;
        if (sr >= 0 && sr < ROWS) ctx.fillRect((scur.x + c) * CELL + 1, sr * CELL + 1, CELL - 2, CELL - 2);
      }
    }
    if (sover) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.max(16, CELL*0.9)}px sans-serif`; ctx.textAlign = 'center';
      ctx.fillText('失衡！游戏结束', w / 2, h / 2);
    }
    if (spaused && !sover) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.max(16, CELL*0.9)}px sans-serif`; ctx.textAlign = 'center';
      ctx.fillText('暂停', w / 2, h / 2);
    }
  }

  // ============================ 手势 ============================
  let sx = 0, sy = 0, st = 0;
  function onSwipe(e) {
    sx = e.clientX; sy = e.clientY; st = Date.now();
    const moveH = (ev) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (mode === 'stack') {
        if (Math.abs(dx) > 26 && Math.abs(dx) > Math.abs(dy)) { nudge(dx > 0 ? 1 : -1); sx = ev.clientX; }
      } else {
        if (Math.abs(dx) > 26 && Math.abs(dx) > Math.abs(dy)) { if (dx > 0) move(1); else move(-1); sx = ev.clientX; draw(); }
        if (dy > 30 && Math.abs(dy) > Math.abs(dx)) { if (dy > 0) step(); else rotate(); sy = ev.clientY; draw(); }
      }
    };
    const end = (ev) => {
      canvas.removeEventListener('pointermove', moveH);
      canvas.removeEventListener('pointerup', end);
      const dy = ev.clientY - sy, dt = Date.now() - st;
      if (mode === 'stack') { if (dy > 50) sDrop(); }
      else if (dy > 60 && dt < 300) hardDrop();
    };
    canvas.addEventListener('pointermove', moveH);
    canvas.addEventListener('pointerup', end);
  }
  function nudge(d) {
    if (sover || spaused) return;
    scur.x = Math.max(0, Math.min(COLS - scur.w, scur.x + d));
    sDraw();
  }

  // ============================ 启动模式 ============================
  function startMode(m) {
    mode = m; hardMode = (m === 'hard');
    stopAll();
    hideOver();
    hideMenu();
    const isStack = (m === 'stack');
    root.querySelector('.tet-next').style.display = isStack ? 'none' : '';
    root.querySelector('#t-rot').style.display = isStack ? 'none' : '';
    root.querySelector('#t-down').style.visibility = isStack ? 'hidden' : '';
    fitCanvas();
    if (isStack) { sReset(); sDraw(); }
    else { reset(); draw(); drawNext(); timer = setInterval(step, 500); }
  }

  function onResize() {
    if (!mountEl) return;
    fitCanvas();
    if (mode === 'stack') sDraw(); else { draw(); drawNext(); }
  }

  window.GameModules = window.GameModules || {};
  window.GameModules.tetris = {
    mount(c) {
      buildDOM(c);
      mountEl = c;
      window.addEventListener('resize', onResize);
      showMenu();
    },
    unmount() {
      stopAll();
      window.removeEventListener('resize', onResize);
      if (root && root.parentElement) root.parentElement.removeChild(root);
      root = null; mountEl = null;
    }
  };
})();
