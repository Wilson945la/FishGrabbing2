/* UNO —— 手机端离线版（移植自桌面 test/src/UnoGame.java 的离线 roomId=0 逻辑）
 * 功能与桌面一致：108 张牌、四种颜色、跳过/反转/+2/变色/+4、普通叠加与逆转叠加两种模式、
 * UNO 喊牌+锤子、+4 质疑、机器人 AI、15 秒出牌限时、6 分钟总时长、结算排名计分。
 * 渲染从 Swing 改为 DOM/CSS（功能等价，布局适配手机）。
 */
(function () {
  'use strict';

  // ===================== 常量 =====================
  const MIN_PLAYERS = 4, MAX_PLAYERS = 8, INITIAL_HAND = 7, TURN_LIMIT_MS = 15000;
  const PLAY_MS = 350, ADVANCE_DELAY = 220, BOT_MIN = 1300, BOT_VAR = 1200;
  const BOT_UNO_MISS = 0.4;       // 机器人出倒数第二张牌时忘记喊 UNO 的概率
  const HAMMER_WINDOW_MS = 5200;  // 机器人露锤子后玩家可抓的窗口
  // 颜色顺序与桌面 UnoCard.Color 枚举声明顺序一致：红/黄/绿/蓝
  const COLORS = ['RED', 'YELLOW', 'GREEN', 'BLUE'];
  const COLOR_HEX = { RED: '#e53935', YELLOW: '#fdd835', GREEN: '#43a047', BLUE: '#1e88e5', BLACK: '#212121' };
  const COLOR_CN = { RED: '红', YELLOW: '黄', GREEN: '绿', BLUE: '蓝', BLACK: '黑' };

  // ===================== 牌模型 =====================
  function makeCard(color, type, number) { return { color, type, number }; }

  function scoreValue(c) {
    if (c.type === 'NUMBER') return c.number;
    if (c.type === 'WILD' || c.type === 'WILD_DRAW_FOUR') return 50;
    return 20; // SKIP / REVERSE / DRAW_TWO
  }

  function displayChar(c) {
    switch (c.type) {
      case 'NUMBER': return String(c.number);
      case 'SKIP': return 'S';
      case 'REVERSE': return 'R';
      case 'DRAW_TWO': return '+2';
      case 'WILD': return 'W';
      case 'WILD_DRAW_FOUR': return '+4';
      default: return '?';
    }
  }

  function isWild(c) { return c.type === 'WILD' || c.type === 'WILD_DRAW_FOUR'; }

  function createDeck() {
    const deck = [];
    for (const col of COLORS) {
      deck.push(makeCard(col, 'NUMBER', 0));
      for (let n = 1; n <= 9; n++) { deck.push(makeCard(col, 'NUMBER', n)); deck.push(makeCard(col, 'NUMBER', n)); }
      for (let i = 0; i < 2; i++) {
        deck.push(makeCard(col, 'SKIP', 0));
        deck.push(makeCard(col, 'REVERSE', 0));
        deck.push(makeCard(col, 'DRAW_TWO', 0));
      }
    }
    for (let i = 0; i < 4; i++) {
      deck.push(makeCard('BLACK', 'WILD', 0));
      deck.push(makeCard('BLACK', 'WILD_DRAW_FOUR', 0));
    }
    return deck; // 4*25 + 8 = 108
  }

  // 与桌面一致的洗牌（带种子）
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, seed) {
    const a = arr.slice();
    const rnd = mulberry32(seed >>> 0);
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // 是否可打出（与桌面 UnoCard.canPlayOn 完全一致）
  function canPlayOn(card, top, activeColor, pendingDraws, reverseStack) {
    if (pendingDraws > 0) {
      if (card.type === 'DRAW_TWO' && top.type === 'DRAW_TWO') return true;
      if (card.type === 'WILD_DRAW_FOUR' && (top.type === 'DRAW_TWO' || top.type === 'WILD_DRAW_FOUR')) return true;
      if (reverseStack && card.type === 'REVERSE' && card.color === activeColor) return true;
      return false;
    }
    if (isWild(card)) return true;
    if (card.color === activeColor) return true;
    if (card.type === 'NUMBER' && top.type === 'NUMBER' && card.number === top.number) return true;
    if (card.type !== 'NUMBER' && card.type !== 'WILD' && card.type !== 'WILD_DRAW_FOUR' && card.type === top.type) return true;
    return false;
  }

  function labelOf(c) {
    switch (c.type) {
      case 'NUMBER': return String(c.number);
      case 'SKIP': return '跳过';
      case 'REVERSE': return '反转';
      case 'DRAW_TWO': return '+2';
      case 'WILD': return '变色';
      case 'WILD_DRAW_FOUR': return '+4';
      default: return '?';
    }
  }

  // ===================== 游戏控制器 =====================
  class UnoGame {
  constructor(container, opts) {
    this.container = container;
    this.user = (opts && opts.user) || null;
    this.phase = 'setup';           // setup | play
    this.setupCount = 4;
    this.setupMode = 0;             // 0 普通叠加, 1 逆转叠加
    this.timers = [];
    this.listener = (e) => this.onClick(e);
    container.addEventListener('click', this.listener);
    // 不自动全屏：进入全屏会让部分手机浏览器锁定当前方向，导致之后转屏无法识别。
    // 全屏改为由用户手动点击 ⛶ 按钮触发（此时方向已选定，可承受全屏锁定）。
    this.forceLandscape = false;
    this.isLandscape = this.checkLandscape();
    // 事件 + 主动轮询双保险：全屏下浏览器常不发 orientationchange / matchMedia 事件，
    // 必须定时读取屏幕几何与 screen.orientation.angle 才能可靠识别转向横屏。
    this.onResize = () => this.updateOrientation();
    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onResize);
    this.mq = window.matchMedia ? window.matchMedia('(orientation: landscape)') : null;
    this.onMq = () => this.updateOrientation();
    if (this.mq) {
      if (this.mq.addEventListener) this.mq.addEventListener('change', this.onMq);
      else if (this.mq.addListener) this.mq.addListener(this.onMq);
    }
    // 轮询兜底：每 250ms 检查一次，确保全屏时转横屏也能被识别
    this.pollTimer = setInterval(() => this.pollOrientation(), 250);
    // 全屏兜底：进入全屏后浏览器常会锁定方向，需主动解除锁定并监听方向变化，否则全屏下转屏识别不到
    this.onFsChange = () => {
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
      if (fsEl) { try { if (window.screen && window.screen.orientation && window.screen.orientation.unlock) window.screen.orientation.unlock(); } catch (e) {} }
      this.updateOrientation();
    };
    document.addEventListener('fullscreenchange', this.onFsChange);
    document.addEventListener('webkitfullscreenchange', this.onFsChange);
    this.onScreenOrient = () => this.updateOrientation();
    if (window.screen && window.screen.orientation && window.screen.orientation.addEventListener) {
      window.screen.orientation.addEventListener('change', this.onScreenOrient);
    }
    document.body.classList.add('uno-active');
    this.dirRingStartMs = Date.now();
    this.render();
  }

  destroy() {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
    this.container.removeEventListener('click', this.listener);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('orientationchange', this.onResize);
    if (this.mq) {
      if (this.mq.removeEventListener) this.mq.removeEventListener('change', this.onMq);
      else if (this.mq.removeListener) this.mq.removeListener(this.onMq);
    }
    if (this.pollTimer) clearInterval(this.pollTimer);
    document.removeEventListener('fullscreenchange', this.onFsChange);
    document.removeEventListener('webkitfullscreenchange', this.onFsChange);
    if (window.screen && window.screen.orientation && window.screen.orientation.removeEventListener) {
      window.screen.orientation.removeEventListener('change', this.onScreenOrient);
    }
    document.body.classList.remove('uno-active');
  }
  checkLandscape() {
    if (this.forceLandscape) return true;
    // 优先用物理方向判断；回退到尺寸 / 设备角度判断（宽屏/桌面也视为横屏）
    if (this.mq && this.mq.matches) return true;
    const so = window.screen && window.screen.orientation ? window.screen.orientation.angle : null;
    if (so === 90 || so === -90 || so === 270) return true;
    if (typeof window.orientation === 'number' && Math.abs(window.orientation) === 90) return true;
    return window.innerWidth > window.innerHeight || window.innerWidth >= 480;
  }
  updateOrientation() {
    const was = this.isLandscape;
    this.isLandscape = this.checkLandscape();
      if (was !== this.isLandscape) {
      this.render();
    }
  }
  // 主动轮询：窗口模式下定时读取真实几何作为兜底，确保转屏一定能被识别
  pollOrientation() {
    const was = this.isLandscape;
    this.isLandscape = this.checkLandscape();
    if (was !== this.isLandscape) {
      this.render();
    }
  }
  later(fn, ms) { const t = setTimeout(fn, ms); this.timers.push(t); return t; }
  clearLater(t) { clearTimeout(t); this.timers = this.timers.filter((x) => x !== t); }

    // ---------- 开局 ----------
    tryFullscreen() {
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
      if (fsEl) {
        // 已在全屏：再次点击 ⛶ 退出全屏（退出后即可正常转屏）
        const exit = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
        if (exit) { try { exit.call(document); } catch (e) {} }
        return;
      }
      const el = document.documentElement;
      if (!el) return;
      const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
      if (req) {
        try { req.call(el); } catch (e) { /* 浏览器可能拒绝，忽略 */ }
      }
    }
    startMatch() {
      const n = this.setupCount;
      const names = [];
      for (let i = 0; i < n; i++) names.push(i === 0 ? (this.user && this.user.name ? this.user.name : '你') : ('机器人' + i));
      this.players = names.map((nm, i) => ({
        name: nm, isBot: i !== 0, hand: [], showHammer: false, calledUno: false,
        pendingDrawsOnMe: 0, finished: false, finishRank: 0, seatRegion: 'self', avatarSeed: i
      }));
      this.myPlayerIdx = 0;
      this.mode = this.setupMode;
      this.drawPile = shuffle(createDeck(), Date.now());
      for (let i = 0; i < INITIAL_HAND; i++) for (const p of this.players) this.drawPile.length ? p.hand.push(this.drawPile.pop()) : null;
      this.sortHand(this.players[0]);

      do { this.topCard = this.drawPile.pop(); } while (this.topCard && this.topCard.type === 'WILD_DRAW_FOUR');
      this.discardPile = [this.topCard];
      this.currentColor = isWild(this.topCard) ? 'RED' : this.topCard.color;

      this.direction = 1;
      this.pendingDraws = 0;
      this.gameOver = false;
      this.winnerIdx = -1;
      this.selectedHandIdx = -1;
      this.waitingForColor = false;
      this.wildCardHandIdx = -1;
      this.waitingForChallenge = false;
      this.challengeFromIdx = -1;
      this.currentColorBeforeChallenge = null;
      this.suppressAutoAdvance = false;
      for (const p of this.players) { p.calledUno = false; p.showHammer = false; }
      this.turnAnimating = false;
      this.colorPicking = false;
      this.colorTimer = null;
      this.drawPlayIdx = null;
      this.drawPlayTimer = null;
      this.challengeDeadlineMs = 0;
      this.challengeTimer = null;
      this.playAnim = null;
      this.unoAnim = null;
      this.lastActionText = '游戏开始！';
      this.lastActionAt = Date.now();
      this.startTime = Date.now();
      this.gameDurationMs = (10 + Math.max(0, n - 4) * 2) * 60000;

      // 起手牌效果
      let firstIdx;
      if (this.topCard.type === 'DRAW_TWO') { this.pendingDraws = 2; firstIdx = (0 + 1) % n; }
      else if (this.topCard.type === 'SKIP') { firstIdx = (0 + 2) % n; }
      else if (this.topCard.type === 'REVERSE') { this.direction = -1; this.dirRingStartMs = Date.now(); firstIdx = (0 + n - 1) % n; }
      else { firstIdx = (0 + 1) % n; }
      this.currentPlayerIdx = firstIdx;

      this.phase = 'play';
      // 不自动全屏：开局即全屏会锁定方向，导致后续转屏无法识别。全屏由 ⛶ 按钮手动触发。
      this.render();
      this.startMatchTimer();
      this.beginTurn();
    }

    startMatchTimer() {
      if (this.matchTimer) clearInterval(this.matchTimer);
      this.matchTimer = setInterval(() => {
        if (this.gameOver) return;
        if (this.remainingMs() <= 0) this.endGame();
        else { this.updateTimerDisplay(); this.updateTimersUI(); }
      }, 500);
      this.timers.push(this.matchTimer);
    }
    updateTimersUI() {
      const tl = this.container.querySelector('.uno-turn-left');
      if (tl) {
        if (this.currentPlayerIdx === 0 && !this.waitingForColor && !this.waitingForChallenge && !this.gameOver && this.turnDeadlineMs) {
          const left = Math.max(0, Math.ceil((this.turnDeadlineMs - Date.now()) / 1000));
          tl.textContent = '出牌 ' + left + 's';
          tl.style.display = '';
        } else tl.style.display = 'none';
      }
      const ct = this.container.querySelector('.uno-ch-timer');
      if (ct) {
        const left = this.challengeDeadlineMs ? Math.max(0, Math.ceil((this.challengeDeadlineMs - Date.now()) / 1000)) : 15;
        ct.textContent = '质疑倒计时 ' + left + 's';
        const bar = this.container.querySelector('.uno-ch-bar > i');
        if (bar) bar.style.width = (left / 15 * 100) + '%';
      }
    }
    updateTimerDisplay() {
      const el = this.container.querySelector('.uno-timer');
      if (!el) return;
      const total = Math.ceil(this.remainingMs() / 1000);
      const m = String(Math.floor(total / 60)).padStart(1, '0');
      const s = String(total % 60).padStart(2, '0');
      el.textContent = '⏱ ' + m + ':' + s;
    }
    remainingMs() { return Math.max(0, this.gameDurationMs - (Date.now() - this.startTime)); }

    // ---------- 回合流程 ----------
    beginTurn() {
      if (this.gameOver) return;
      this.players[this.currentPlayerIdx].showHammer = false;
      const p = this.players[this.currentPlayerIdx];
      if (this.pendingDraws > 0 && !this.canStack(this.currentPlayerIdx)) { this.forceTakePending(this.currentPlayerIdx); return; }
      if (p.isBot) this.scheduleBotTurn(p);
      else { this.startTurnTimer(); this.render(); }
    }
    startTurnTimer() {
      if (this.turnTimer) clearTimeout(this.turnTimer);
      this.turnDeadlineMs = Date.now() + TURN_LIMIT_MS;
      this.turnTimer = this.later(() => this.autoPlayOffline(), TURN_LIMIT_MS);
    }
    stopTurnTimer() { if (this.turnTimer) { clearTimeout(this.turnTimer); this.turnTimer = null; } this.turnDeadlineMs = 0; }

    autoPlayOffline() {
      if (this.gameOver || this.turnAnimating) return;
      if (this.currentPlayerIdx !== 0) return;
      if (this.waitingForColor || this.waitingForChallenge) return;
      const me = this.players[0];
      let playIdx = -1;
      for (let i = 0; i < me.hand.length; i++) { const c = me.hand[i]; if (!isWild(c) && canPlayOn(c, this.topCard, this.currentColor, this.pendingDraws, this.mode === 1)) { playIdx = i; break; } }
      if (playIdx < 0) for (let i = 0; i < me.hand.length; i++) { const c = me.hand[i]; if (canPlayOn(c, this.topCard, this.currentColor, this.pendingDraws, this.mode === 1)) { playIdx = i; break; } }
      if (playIdx >= 0) {
        const c = me.hand[playIdx];
        this.showAction('超时，系统帮你出了 ' + (isWild(c) ? '变色万能' : COLOR_CN[c.color] + (displayChar(c) ? ' ' + displayChar(c) : '')));
        if (isWild(c)) this.tryPlayCard(0, playIdx, this.mostHandColor());
        else this.tryPlayCard(0, playIdx, null);
        return;
      }
      if (this.pendingDraws > 0) { this.forceTakePending(0); return; }
      me.calledUno = false;
      const drawn = this.drawCards(me, 1);
      if (!drawn) { this.advanceTurn(); return; }
      this.lastDrawnCount = 1; this.lastDrawnAt = Date.now();
      const di = me.hand.indexOf(drawn);
      this.showAction('超时，你摸了 1 张牌');
      if (canPlayOn(drawn, this.topCard, this.currentColor, this.pendingDraws, this.mode === 1)) {
        if (isWild(drawn)) this.tryPlayCard(0, di, this.mostHandColor());
        else this.tryPlayCard(0, di, null);
      } else this.advanceTurn();
    }

    canStack(idx) {
      const p = this.players[idx];
      for (const c of p.hand) if (canPlayOn(c, this.topCard, this.currentColor, this.pendingDraws, this.mode === 1)) return true;
      return false;
    }
    forceTakePending(idx) {
      const p = this.players[idx];
      this.drawCards(p, this.pendingDraws);
      this.showAction(p.name + ' 接收了 ' + this.pendingDraws + ' 张');
      this.pendingDraws = 0;
      for (const q of this.players) q.pendingDrawsOnMe = 0;
      this.advanceTurn();
    }

    drawCards(p, count) {
      let last = null;
      for (let i = 0; i < count; i++) {
        if (this.drawPile.length === 0) this.replenishDrawPile();
        if (this.drawPile.length === 0) break;
        last = this.drawPile.pop();
        p.hand.push(last);
      }
      // 摸到牌后不再处于「已喊 UNO」安全态，且清除待抓锤子
      p.calledUno = false;
      p.showHammer = false;
      if (p === this.players[0]) this.sortHand(p);
      return last;
    }
    sortHand(p) {
      p.hand.sort((a, b) => {
        const ga = this.groupOf(a), gb = this.groupOf(b);
        if (ga !== gb) return ga - gb;
        return this.rankOf(a) - this.rankOf(b);
      });
      if (p === this.players[0]) this.selectedHandIdx = -1;
    }
    groupOf(c) {
      if (c.color === 'BLACK') return 0;
      switch (c.color) { case 'RED': return 1; case 'YELLOW': return 2; case 'BLUE': return 3; case 'GREEN': return 4; default: return 5; }
    }
    rankOf(c) {
      switch (c.type) {
        case 'WILD_DRAW_FOUR': return 0;
        case 'WILD': return 1;
        case 'DRAW_TWO': return 2;
        case 'SKIP': return 3;
        case 'REVERSE': return 4;
        case 'NUMBER': return 5 + (9 - c.number);
        default: return 20;
      }
    }
    replenishDrawPile() {
      if (this.discardPile.length <= 1) return;
      const top = this.discardPile.pop();
      const rest = this.discardPile.slice();
      this.discardPile.length = 0;
      this.discardPile.push(top);
      const sh = shuffle(rest, Date.now());
      for (const c of sh) this.drawPile.push(c);
    }
    nextIdx(from, steps) {
      const n = this.players.length;
      let idx = from;
      for (let i = 0; i < steps; i++) idx = (idx + this.direction + n) % n;
      return idx;
    }
    advanceTurn() {
      for (const q of this.players) q.pendingDrawsOnMe = 0;
      this.currentPlayerIdx = this.nextIdx(this.currentPlayerIdx, 1);
      if (this.pendingSkip) { this.currentPlayerIdx = this.nextIdx(this.currentPlayerIdx, 1); this.pendingSkip = false; }
      if (this.pendingReplay) { this.currentPlayerIdx = this.replayIdx; this.pendingReplay = false; }
      this.selectedHandIdx = -1;
      this.beginTurn();
    }

    // ---------- 人类输入 ----------
    onHandCardClicked(handIdx) {
      if (this.gameOver || this.turnAnimating) return;
      if (this.currentPlayerIdx !== 0) return;
      if (this.waitingForColor || this.waitingForChallenge) return;
      const me = this.players[0];
      if (handIdx < 0 || handIdx >= me.hand.length) return;
      const c = me.hand[handIdx];
      if (this.selectedHandIdx === handIdx) {
        if (canPlayOn(c, this.topCard, this.currentColor, this.pendingDraws, this.mode === 1)) {
          this.stopTurnTimer();
          this.tryPlayCard(0, handIdx, null);
        } else { this.showAction('这张牌不能出'); this.selectedHandIdx = -1; this.render(); }
      } else { this.selectedHandIdx = handIdx; this.render(); }
    }
    onDrawClicked() {
      if (this.gameOver || this.turnAnimating) return;
      if (this.currentPlayerIdx !== 0) return;
      if (this.waitingForColor || this.waitingForChallenge) return;
      if (this.pendingDraws > 0) { this.showAction('已被加牌，不能主动摸牌'); this.render(); return; }
      this.stopTurnTimer();
      const me = this.players[0];
      me.calledUno = false;
      const drawn = this.drawCards(me, 1);
      if (!drawn) { this.advanceTurn(); return; }
      this.lastDrawnCount = 1; this.lastDrawnAt = Date.now();
      this.showAction('你摸了 1 张牌');
      if (canPlayOn(drawn, this.topCard, this.currentColor, this.pendingDraws, this.mode === 1)) {
        this.drawPlayIdx = me.hand.indexOf(drawn);
        this.render();
        this.drawPlayTimer = this.later(() => { if (this.drawPlayIdx != null) { this.drawPlayIdx = null; this.advanceTurn(); } }, 6000);
      } else { this.showAction('此牌不可出，跳过回合'); this.advanceTurn(); }
    }
    onDrawPlayYes() {
      if (this.drawPlayIdx == null) return;
      if (this.drawPlayTimer) this.clearLater(this.drawPlayTimer);
      const idx = this.drawPlayIdx; this.drawPlayIdx = null;
      this.tryPlayCard(0, idx, null);
    }
    onDrawPlayNo() {
      if (this.drawPlayIdx == null) return;
      if (this.drawPlayTimer) this.clearLater(this.drawPlayTimer);
      this.drawPlayIdx = null; this.render(); this.advanceTurn();
    }
    showColorPicker() { this.colorPicking = true; this.render(); }
    onColorPicked(color) {
      if (!this.waitingForColor) return;
      this.waitingForColor = false;
      if (this.colorTimer) { clearTimeout(this.colorTimer); this.colorTimer = null; }
      this.colorPicking = false;
      if (this.currentPlayerIdx === 0) this.stopTurnTimer();
      this.currentColor = color;
      if (this.wildCardHandIdx === -1) { this.render(); return; }
      const handIdx = this.wildCardHandIdx; this.wildCardHandIdx = -1;
      this.applyPlayCard(0, handIdx, color);
    }
    onChallengeDecision(challenge) {
      if (!this.waitingForChallenge) return;
      this.waitingForChallenge = false;
      if (this.challengeTimer) { this.clearLater(this.challengeTimer); this.challengeTimer = null; }
      this.challengeDeadlineMs = 0;
      this.stopTurnTimer();
      const fromIdx = this.challengeFromIdx;
      if (fromIdx < 0) { this.clearPendingDraws(); this.advanceTurn(); return; }
      const from = this.players[fromIdx];
      const hasMatch = this.hasPlayableCardExcludingWild4(from, this.currentColorBeforeChallenge);
      if (challenge) {
        if (hasMatch) { this.drawCards(from, 4); this.showAction('质疑成功！ ' + from.name + ' 自摸 4 张'); }
        else { this.drawCards(this.players[0], 6); this.showAction('质疑失败！ 你摸 6 张'); }
      } else {
        this.drawCards(this.players[0], 4); this.showAction('你摸了 4 张，跳过回合');
        this.clearPendingDraws(); this.advanceTurn(); return;
      }
      this.clearPendingDraws(); this.advanceTurn();
    }
    clearPendingDraws() { this.pendingDraws = 0; for (const q of this.players) q.pendingDrawsOnMe = 0; }
    hasPlayableCardExcludingWild4(p, activeColor) {
      for (const c of p.hand) {
        if (c.type === 'WILD_DRAW_FOUR') continue;
        if (canPlayOn(c, this.topCard, activeColor, 0, false)) return true;
      }
      return false;
    }

    // ---------- 出牌（人/机共用） ----------
    tryPlayCard(playerIdx, handIdx, chosenColor) {
      const p = this.players[playerIdx];
      if (handIdx < 0 || handIdx >= p.hand.length) return;
      const c = p.hand[handIdx];
      if (isWild(c) && chosenColor == null) {
        this.wildCardHandIdx = handIdx;
        this.waitingForColor = true;
        if (playerIdx !== 0) { this.currentColor = this.pickBotColor(p); this.wildCardHandIdx = -1; this.waitingForColor = false; this.applyPlayCard(playerIdx, handIdx, this.currentColor); }
        else { this.stopTurnTimer(); this.showColorPicker(); }
        return;
      }
      this.applyPlayCard(playerIdx, handIdx, chosenColor);
    }
    applyPlayCard(playerIdx, handIdx, chosenColor) {
      const p = this.players[playerIdx];
      if (handIdx < 0 || handIdx >= p.hand.length) return;
      const c = p.hand.splice(handIdx, 1)[0];
      const beforeColor = this.currentColor;
      this.topCard = c; this.discardPile.push(c);
      if (isWild(c)) this.currentColor = chosenColor != null ? chosenColor : this.pickBotColor(p);
      else this.currentColor = c.color;
      this.selectedHandIdx = -1;
      p.pendingDrawsOnMe = 0;
      this.waitingForColor = false;
      const goingToUno = (p.hand.length === 1);
      if (goingToUno) {
        // 刚打出倒数第二张、剩 1 张：是否已喊 UNO 决定是否被抓
        if (p.calledUno) {
          p.showHammer = false; this.beep();
          this.showAction(p.name + ' 喊了 UNO！'); this.triggerUnoAnim(playerIdx, 'UNO!');
        } else if (p.isBot) {
          // 机器人以概率忘记喊 UNO，露锤子供玩家抓；否则视为已喊
          if (Math.random() < BOT_UNO_MISS) {
            p.showHammer = true; p.hammerShownAt = Date.now();
            this.later(() => { if (p.showHammer) { p.showHammer = false; this.render(); } }, HAMMER_WINDOW_MS);
          } else {
            p.calledUno = true; p.showHammer = false; this.beep();
            this.showAction(p.name + ' 喊了 UNO！'); this.triggerUnoAnim(playerIdx, 'UNO!');
          }
        } else {
          // 玩家忘记喊，随机一名机器人自动抓：玩家 +2
          this.autoCatchHuman(playerIdx);
        }
      } else p.showHammer = false;
      this.turnAnimating = true;
      this.playAnim = { card: c, from: playerIdx };
      if (c.type === 'REVERSE') { this.direction = -this.direction; this.dirRingStartMs = Date.now(); }
      this.render();
      this.later(() => {
        this.playAnim = null;
        this.applyCardEffect(c, playerIdx, beforeColor);
        if (p.hand.length === 0) {
          p.finished = true;
          if (this.winnerIdx < 0) this.winnerIdx = playerIdx;
          this.later(() => { if (!this.gameOver) this.endGame(); }, 220);
          return;
        }
        this.turnAnimating = false;
        if (!this.suppressAutoAdvance) this.later(() => this.advanceTurn(), ADVANCE_DELAY);
        else this.suppressAutoAdvance = false;
      }, PLAY_MS);
    }
    applyCardEffect(c, playerIdx, beforeColor) {
      this.pendingSkip = false; this.pendingReplay = false;
      switch (c.type) {
        case 'NUMBER': break;
        case 'SKIP': this.pendingSkip = true; this.showAction(this.players[this.nextIdx(playerIdx, 1)].name + ' 被跳过！'); break;
        case 'REVERSE':
          if (this.players.length <= 2) { this.pendingReplay = true; this.replayIdx = playerIdx; }
          break;
        case 'DRAW_TWO':
          this.pendingDraws += 2;
          this.players[this.nextIdx(playerIdx, 1)].pendingDrawsOnMe = this.pendingDraws;
          break;
        case 'WILD': break;
        case 'WILD_DRAW_FOUR': {
          this.pendingDraws += 4;
          const next = this.nextIdx(playerIdx, 1);
          this.players[next].pendingDrawsOnMe = this.pendingDraws;
          if (next === 0) {
            this.currentColorBeforeChallenge = this.currentColor;
            this.challengeFromIdx = playerIdx;
            this.waitingForChallenge = true;
            this.suppressAutoAdvance = true;
            this.challengeDeadlineMs = Date.now() + 15000;
            if (this.challengeTimer) this.clearLater(this.challengeTimer);
            this.challengeTimer = this.later(() => { if (this.waitingForChallenge) this.onChallengeDecision(false); }, 15000);
            this.render();
          }
          break;
        }
      }
    }

    // ---------- 机器人 ----------
    scheduleBotTurn(p) {
      const delay = BOT_MIN + Math.floor(Math.random() * BOT_VAR);
      this.later(() => this.botPlay(p), delay);
    }
    botPlay(p) {
      if (this.gameOver) return;
      if (this.pendingDraws > 0) {
        const stack = this.pickBotStack(p);
        if (stack) {
          const idx = p.hand.indexOf(stack);
          const col = isWild(stack) ? this.pickBotColor(p) : null;
          if (stack.type === 'WILD_DRAW_FOUR') this.currentColorBeforeChallenge = stack.color;
          this.applyPlayCard(this.players.indexOf(p), idx, col);
          return;
        }
        return; // beginTurn 已处理强制吃
      }
      const chosen = this.pickBotPlay(p);
      if (!chosen) {
        this.drawCards(p, 1);
        this.showAction(p.name + ' 摸了 1 张');
        this.later(() => this.advanceTurn(), 900);
        return;
      }
      const idx = p.hand.indexOf(chosen);
      const col = isWild(chosen) ? this.pickBotColor(p) : null;
      if (chosen.type === 'WILD_DRAW_FOUR') this.currentColorBeforeChallenge = chosen.color;
      this.applyPlayCard(this.players.indexOf(p), idx, col);
    }
    pickBotStack(p) {
      for (const c of p.hand) if (c.type === 'WILD_DRAW_FOUR') return c;
      for (const c of p.hand) if (c.type === 'DRAW_TWO') return c;
      if (this.mode === 1) for (const c of p.hand) if (c.type === 'REVERSE' && c.color === this.currentColor) return c;
      return null;
    }
    pickBotPlay(p) {
      let best = null, firstNumber = null;
      for (const c of p.hand) {
        if (!canPlayOn(c, this.topCard, this.currentColor, 0, false)) continue;
        if (c.type !== 'NUMBER') { if (best == null || this.priority(c) > this.priority(best)) best = c; }
        else if (firstNumber == null) firstNumber = c;
      }
      return best != null ? best : firstNumber;
    }
    priority(c) {
      switch (c.type) {
        case 'WILD_DRAW_FOUR': return 5;
        case 'DRAW_TWO': return 4;
        case 'WILD': return 3;
        case 'SKIP': return 2;
        case 'REVERSE': return 1;
        default: return 0;
      }
    }
    pickBotColor(p) {
      const cnt = [0, 0, 0, 0];
      for (const c of p.hand) {
        if (isWild(c) || c.type === 'NUMBER') {
          const i = COLORS.indexOf(c.color);
          if (i >= 0) cnt[i]++;
        }
      }
      let best = 0, max = -1;
      for (let i = 0; i < 4; i++) if (cnt[i] > max) { max = cnt[i]; best = i; }
      return COLORS[best];
    }
    mostHandColor() {
      const me = this.players[0];
      const cnt = [0, 0, 0, 0];
      for (const c of me.hand) { const i = COLORS.indexOf(c.color); if (i >= 0) cnt[i]++; }
      let max = -1; for (let i = 0; i < 4; i++) if (cnt[i] > max) max = cnt[i];
      const best = []; for (let i = 0; i < 4; i++) if (cnt[i] === max) best.push(i);
      return COLORS[best[Math.floor(Math.random() * best.length)]];
    }

    // ---------- UNO 喊牌 + 锤子 ----------
    onUnoButtonPressed() {
      if (this.gameOver) return;
      const me = this.players[0];
      if (this.currentPlayerIdx !== 0) { this.showAction('还没轮到你'); this.render(); return; }
      if (me.hand.length !== 2) { this.showAction('要在打倒数第二张牌前（剩 2 张时）点 UNO'); this.render(); return; }
      if (!this.canStack(0)) { this.showAction('没有可出的倒数第二张牌，不能喊 UNO'); this.render(); return; }
      if (me.calledUno) { this.showAction('你已经喊过 UNO 了'); this.render(); return; }
      me.calledUno = true; me.showHammer = false; this.beep();
      this.showAction('你喊了 UNO！'); this.triggerUnoAnim(0, 'UNO!');
    }
    // UNO/抓牌字样从喊牌者（idx）所在方位冒出
    triggerUnoAnim(idx, text) {
      const o = this.playOrigin(idx);
      this.unoAnim = { fx: o.fx, fy: o.fy, text: text || 'UNO!', start: Date.now() };
      this.render();
      this.later(() => { this.unoAnim = null; this.render(); }, 1000);
    }
    // 玩家打倒数第二张却没喊 UNO：随机一名机器人自动抓，玩家 +2
    autoCatchHuman(humanIdx) {
      const cand = [];
      for (let i = 1; i < this.players.length; i++) if (!this.players[i].finished) cand.push(i);
      if (cand.length === 0) return;
      const ci = cand[Math.floor(Math.random() * cand.length)];
      const t = this.players[ci];
      this.drawCards(this.players[0], 2);
      this.beep();
      this.showAction(t.name + ' 抓到你没喊 UNO！你 +2 张');
      this.triggerUnoAnim(ci, '抓到!');
    }
    onHammerClicked(targetIdx) {
      if (this.gameOver) return;
      if (targetIdx === 0) return;
      const t = this.players[targetIdx];
      if (!t.showHammer) return;
      this.drawCards(t, 2); t.showHammer = false; t.calledUno = false; this.beep();
      this.showAction('抓到 ' + t.name + ' 没喊 UNO！它 +2 张');
      this.triggerUnoAnim(0, '抓到!'); // 从玩家处飞出「抓到!」
    }

    // ---------- 结束 / 计分 ----------
    endGame() {
      if (this.gameOver) return;
      this.gameOver = true;
      if (this.matchTimer) clearInterval(this.matchTimer);
      this.stopTurnTimer();
      const order = this.players.slice();
      order.sort((a, b) => {
        if (a.finished && b.finished) return a.hand.length - b.hand.length;
        if (a.finished) return -1;
        if (b.finished) return 1;
        const sa = this.handValue(a), sb = this.handValue(b);
        if (sa !== sb) return sa - sb;
        return a.hand.length - b.hand.length;
      });
      for (let i = 0; i < order.length; i++) order[i].finishRank = i + 1;
      this.ranking = order;
      this.render();
    }
    handValue(p) { let s = 0; for (const c of p.hand) s += scoreValue(c); return s; }

    // ---------- 辅助 ----------
    showAction(s) { this.lastActionText = s; this.lastActionAt = Date.now(); this.render(); }
    beep() { try { const ac = new (window.AudioContext || window.webkitAudioContext)(); const o = ac.createOscillator(); o.frequency.value = 660; o.connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.08); } catch (e) {} }
    esc(s) { return String(s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])); }

    // 按人数返回对手在三边的分配：左/上/右
    opponentLayout(n) {
      if (n >= 8) return { left: 2, top: 3, right: 2 };
      if (n === 7) return { left: 2, top: 2, right: 2 };
      if (n === 6) return { left: 2, top: 2, right: 1 };
      if (n === 5) return { left: 1, top: 2, right: 1 };
      return { left: 1, top: 1, right: 1 }; // 4人
    }

    // 出牌动画起点：从出牌方所在方位飞出。相对 .uno-table 的百分比坐标
    playOrigin(idx) {
      if (idx === 0) return { fx: 12, fy: 84 }; // 自己：左下角头像处
      const pos = this.oppPositions ? this.oppPositions[idx - 1] : null;
      if (!pos) return { fx: 50, fy: 12 };
      if (pos.side === 'left') {
        const fy = pos.count === 1 ? 25 : 38 - pos.idx * (26 / (pos.count - 1));
        return { fx: 4, fy };
      }
      if (pos.side === 'right') {
        const fy = pos.count === 1 ? 25 : 12 + pos.idx * (26 / (pos.count - 1));
        return { fx: 96, fy };
      }
      // top
      const fx = pos.count === 1 ? 50 : 22 + pos.idx * (56 / (pos.count - 1));
      return { fx, fy: 7 };
    }

    // ===================== 渲染 =====================
    cardFace(c, faceDown) {
      if (faceDown) return '<div class="uno-face back"><span class="uno-back-logo">UNO</span></div>';
      const cls = (c.color === 'BLACK' ? (c.type === 'WILD_DRAW_FOUR' ? 'c-wild4' : 'c-wild') : 'c-' + c.color.toLowerCase());
      let sym;
      if (c.type === 'NUMBER') sym = String(c.number);
      else if (c.type === 'SKIP') sym = '⊘';
      else if (c.type === 'REVERSE') sym = '⇄';
      else if (c.type === 'DRAW_TWO') sym = '+2';
      else if (c.type === 'WILD') sym = '';
      else sym = '+4';
      let corner;
      if (c.type === 'NUMBER') corner = c.number;
      else if (c.type === 'DRAW_TWO') corner = '+2';
      else if (c.type === 'WILD_DRAW_FOUR') corner = '+4';
      else if (c.type === 'SKIP') corner = 'S';
      else if (c.type === 'REVERSE') corner = 'R';
      else corner = '';
      return '<div class="uno-face ' + cls + '">' +
        '<span class="uno-corner tl">' + corner + '</span>' +
        '<span class="uno-corner br">' + corner + '</span>' +
        '<div class="uno-oval">' + (sym ? '<span class="uno-sym">' + sym + '</span>' : '') + '</div>' +
        '</div>';
    }

    render() {
      if (this.phase === 'setup') { this.container.innerHTML = this.setupHTML(); return; }
      const n = this.players.length;
      const me = this.players[0];
      const canAct = this.currentPlayerIdx === 0 && !this.waitingForColor && !this.waitingForChallenge && !this.turnAnimating && !this.gameOver;

      // 顶部栏
      const mm = this.remainingMs();
      const m = String(Math.floor(mm / 60000)).padStart(2, '0');
      const s = String(Math.floor((mm % 60000) / 1000)).padStart(2, '0');
      let turnLeft = '';
      if (this.currentPlayerIdx === 0 && !this.waitingForColor && !this.waitingForChallenge && !this.gameOver) {
        const left = Math.max(0, Math.ceil((this.turnDeadlineMs - Date.now()) / 1000));
        turnLeft = '出牌 ' + left + 's';
      }

      // 方桌贴边布局：自己头像在左下角，对手按人数分配到左/上/右三边
      const AVA_COLORS = ['#d4f1f9', '#e0d4f9', '#fff2cc', '#ffd9e6', '#d9f2d0', '#ffe6cc', '#e6e6fa', '#f9d4d4'];
      const layout = this.opponentLayout(n);
      const oppPositions = [];
      for (let i = 1; i < n; i++) {
        if (i <= layout.left) oppPositions.push({ side: 'left', idx: i - 1, count: layout.left });
        else if (i <= layout.left + layout.top) oppPositions.push({ side: 'top', idx: i - layout.left - 1, count: layout.top });
        else oppPositions.push({ side: 'right', idx: i - layout.left - layout.top - 1, count: layout.right });
      }
      this.oppPositions = oppPositions;
      let oppHTML = '';
      for (let i = 1; i < n; i++) {
        const p = this.players[i];
        const pos = oppPositions[i - 1];
        const active = (i === this.currentPlayerIdx) ? ' active' : '';
        const disc = (p.finished ? '出完' : String(p.hand.length));
        const backs = p.finished ? '' : '<div class="uno-opp-backrow">' + Array(Math.min(p.hand.length, 25)).fill('<span class="mini-back">U</span>').join('') + '</div>';
        const pend = p.pendingDrawsOnMe > 0 ? '<span class="uno-pend-opp">+' + p.pendingDrawsOnMe + '</span>' : '';
        const hammer = p.showHammer ? '<button class="uno-hammer-ava" data-action="hammer" data-idx="' + i + '">🔨</button>' : '';
        let style = '', cls = 'uno-opp' + active;
        if (pos.side === 'left') {
          // 左列：顺时针座位，机器人1(idx 0)在下方贴近自己、其余向上排列；只分布在上半屏避免遮住底部手牌
          const top = pos.count === 1 ? 25 : 38 - pos.idx * (26 / (pos.count - 1));
          cls += ' left-col'; style = 'left:2%;top:' + top + '%';
        } else if (pos.side === 'top') {
          const left = pos.count === 1 ? 50 : 22 + pos.idx * (56 / (pos.count - 1));
          cls += ' top-row'; style = 'left:' + left + '%;top:7%';
        } else {
          // 右列只分布在上半屏
          const top = pos.count === 1 ? 25 : 12 + pos.idx * (26 / (pos.count - 1));
          cls += ' right-col'; style = 'right:2%;top:' + top + '%';
        }
        oppHTML += '<div class="' + cls + '" style="' + style + '">' +
          '<div class="uno-ava-disc" style="background:' + AVA_COLORS[i % AVA_COLORS.length] + '">' + disc + hammer + '</div>' +
          '<div class="uno-opp-name">' + this.esc(p.name) + '</div>' +
          backs + pend + '</div>';
      }
      const selfActive = (this.currentPlayerIdx === 0) ? ' active' : '';

      // 玩家回合提示态：可出牌闪烁已由 CSS(.playable)处理；无牌可出时摸牌按钮闪烁；摸到可出牌提示是否打出
      let anyPlayable = false;
      for (const c of me.hand) { if (canPlayOn(c, this.topCard, this.currentColor, this.pendingDraws, this.mode === 1)) { anyPlayable = true; break; } }
      const drawBlink = (canAct && !anyPlayable && this.drawPlayIdx == null) ? ' blink-draw' : '';
      const drawPrompt = this.drawPlayIdx != null
        ? '<div class="uno-draw-prompt">摸到可出牌，是否打出？<button class="yes" data-action="draw-yes">打出</button><button class="no" data-action="draw-no">不打</button></div>'
        : '';

      // 手牌
      let handHTML = '';
      for (let i = 0; i < me.hand.length; i++) {
        const c = me.hand[i];
        const playable = canAct && canPlayOn(c, this.topCard, this.currentColor, this.pendingDraws, this.mode === 1);
        const sel = (i === this.selectedHandIdx) ? ' selected' : '';
        handHTML += '<div class="uno-card' + (playable ? ' playable' : '') + sel + '" data-action="card" data-idx="' + i + '">' + this.cardFace(c, false) + '</div>';
      }

      const unoDis = !(this.currentPlayerIdx === 0 && me.hand.length === 2 && this.canStack(0) && !this.gameOver) || me.calledUno;
      const unoLabel = me.calledUno ? 'UNO✓' : 'UNO!';
      const drawDis = !canAct || this.pendingDraws > 0;
      const dirClass = this.direction === 1 ? 'cw' : 'ccw';
      const ringDelay = (-(Date.now() - this.dirRingStartMs) / 1000).toFixed(2) + 's';
      const actionShow = Date.now() - this.lastActionAt < 2600 ? this.esc(this.lastActionText) : '';
      const topMode = actionShow ? '<span class="uno-action-top">' + actionShow + '</span>' : '<span class="uno-mode">模式：' + (this.mode === 1 ? '逆转叠加' : '普通叠加') + ' · ' + n + '人</span>';
      const overlay = this.overlayHTML();
      const portrait = !this.isLandscape;
      const handOverlap = me.hand.length > 5 ? ' overlap' : '';

      this.container.innerHTML =
        '<div class="uno' + (portrait ? ' portrait' : '') + '">' +
          '<div class="uno-topbar">' +
            '<button class="uno-back" data-action="back">‹ 返回</button>' +
            '<div class="uno-timer">⏱ ' + m + ':' + s + '</div>' +
            topMode +
            '<div class="uno-turn-left">' + turnLeft + '</div>' +
            '<div class="uno-me">我：' + me.hand.length + '张</div>' +
            '<button class="uno-fs" data-action="fullscreen" title="全屏（隐藏浏览器栏）">⛶</button>' +
          '</div>' +
          '<div class="uno-table">' +
            '<div class="uno-dir-ring ' + dirClass + '" style="color:' + COLOR_HEX[this.currentColor] + ';animation-delay:' + ringDelay + '">' + this.dirRingSVG() + '</div>' +
            '<div class="uno-center">' +
              '<button class="uno-pile draw' + drawBlink + '" data-action="draw" ' + ((this.drawPlayIdx != null || !canAct) ? 'disabled' : '') + '>' +
                '<span class="uno-back-logo">UNO</span><span class="uno-draw-label">摸牌</span><span class="uno-draw-cnt">' + this.drawPile.length + '</span>' +
              '</button>' +
              '<div class="uno-pile discard">' + this.cardFace(this.topCard, false) + '</div>' +
            '</div>' +
            oppHTML +
            drawPrompt +
            (this.playAnim ? (() => { const o = this.playOrigin(this.playAnim.from); return '<div class="uno-play-anim" style="--fx:' + o.fx + '%;--fy:' + o.fy + '%">' + this.cardFace(this.playAnim.card, false) + '</div>'; })() : '') +
            (this.unoAnim ? '<div class="uno-uno-fly" style="--fx:' + this.unoAnim.fx + '%;--fy:' + this.unoAnim.fy + '%">' + this.unoAnim.text + '</div>' : '') +
            '<div class="uno-self' + selfActive + '">' +
              '<div class="uno-ava-disc" style="background:' + AVA_COLORS[0] + '">' + me.hand.length + '</div>' +
              '<div class="uno-self-name">玩家</div>' +
            '</div>' +
          '</div>' +
          '<div class="uno-hand' + handOverlap + '">' + handHTML + '</div>' +
          '<button class="uno-uno-side" data-action="uno" ' + (unoDis ? 'disabled' : '') + '>' + unoLabel + '</button>' +
          '<div class="uno-rotate-hint">📱 横屏体验更佳</div>' +
          overlay +
        '</div>';
    }

    dirRingSVG() {
      // 直接移植桌面 drawDirectionRing 的数学（UnoGame.java:1613）。
      // 坐标系与桌面一致：y 向下，点 = (cx + r·cosA, cy + r·sinA)；角度增大 = 屏幕顺时针。
      // 两条弧各长 ARC_SPAN ≈130°，相隔 180°；每条弧两端各一个箭头（共 4 个），靠 direction 控制切向。
      const col = COLOR_HEX[this.currentColor] || '#1e88e5';
      const cx = 100, cy = 100, r = 88;
      const ARC_SPAN = Math.PI * 0.72;            // ≈130°，与桌面一致
      const basePhase = -Math.PI / 2;             // 桌面为 ringSpin - π/2；手机端自转交给 CSS，这里固定基准相位
      const tipLen = 0.18, halfW = 0.12;          // 箭头尺寸比例（相对 r）
      const d = this.direction;                   // 1=顺时针, -1=逆时针
      const pt = (A) => [cx + r * Math.cos(A), cy + r * Math.sin(A)];
      const f = (n) => n.toFixed(1);
      let svg = '<svg viewBox="0 0 200 200">';
      for (let k = 0; k < 2; k++) {
        const phase = basePhase + k * (ARC_SPAN + (Math.PI * 2 - 2 * ARC_SPAN) / 2); // 第二条弧偏移 180°
        const a0 = phase - ARC_SPAN / 2, a1 = phase + ARC_SPAN / 2;
        const [x0, y0] = pt(a0), [x1, y1] = pt(a1);
        // 短弧（跨度 <180°），角度增大方向 = 顺时针 = sweep=1
        svg += '<path d="M' + f(x0) + ',' + f(y0) + ' A' + r + ',' + r + ' 0 0 1 ' + f(x1) + ',' + f(y1) +
               '" fill="none" stroke="' + col + '" stroke-width="8" stroke-linecap="round"/>';
        // 两端各画一个箭头；切向与桌面完全一致：tv = d·(-sinA, cosA)
        for (const A of [a0, a1]) {
          const [ex, ey] = pt(A);
          let tvx = d * (-Math.sin(A)), tvy = d * (Math.cos(A));
          const tn = Math.hypot(tvx, tvy); tvx /= tn; tvy /= tn;
          const tipX = ex + tvx * tipLen * r, tipY = ey + tvy * tipLen * r;
          const nrmX = -tvy * halfW * r, nrmY = tvx * halfW * r;
          svg += '<polygon points="' + f(tipX) + ',' + f(tipY) + ' ' +
                 f(ex + nrmX) + ',' + f(ey + nrmY) + ' ' +
                 f(ex - nrmX) + ',' + f(ey - nrmY) + '" fill="' + col + '"/>';
        }
      }
      return svg + '</svg>';
    }

    overlayHTML() {
      if (this.colorPicking) {
        let btns = '';
        for (const col of COLORS) btns += '<button class="uno-color-btn c-' + col.toLowerCase() + '" data-action="color" data-color="' + col + '">' + COLOR_CN[col] + '</button>';
        return '<div class="uno-overlay"><div class="uno-picker"><p>选择颜色</p><div class="uno-colors">' + btns + '</div></div></div>';
      }
      if (this.waitingForChallenge) {
        const from = this.players[this.challengeFromIdx];
        const chLeft = this.challengeDeadlineMs ? Math.max(0, Math.ceil((this.challengeDeadlineMs - Date.now()) / 1000)) : 15;
        const chPct = this.challengeDeadlineMs ? (chLeft / 15 * 100) : 100;
        return '<div class="uno-overlay"><div class="uno-challenge">' +
          '<p><b>' + this.esc(from.name) + '</b> 出了 +4（变色：' + COLOR_CN[this.currentColor] + '）</p>' +
          '<div class="uno-ch-timer">质疑倒计时 ' + chLeft + 's</div>' +
          '<div class="uno-ch-bar"><i style="width:' + chPct + '%"></i></div>' +
          '<p class="uno-ch-sub">质疑成功：对方自加 4 张<br>质疑失败：你加 6 张<br>不质疑：你加 4 张</p>' +
          '<div class="uno-ch-btns">' +
            '<button class="uno-act yes" data-action="challenge" data-v="1">质疑</button>' +
            '<button class="uno-act no" data-action="challenge" data-v="0">不质疑</button>' +
          '</div></div></div>';
      }
      if (this.gameOver) {
        let rows = '';
        for (let i = 0; i < this.ranking.length; i++) {
          const p = this.ranking[i];
          rows += '<div class="uno-rank-row"><span class="uno-rank-no">' + (i + 1) + '</span>' +
            '<span class="uno-rank-name">' + this.esc(p.name) + (p.finished ? '（出完）' : '（' + p.hand.length + '张，扣' + this.handValue(p) + '分）') + '</span></div>';
        }
        return '<div class="uno-overlay"><div class="uno-end">' +
          '<h3>游戏结束</h3>' +
          '<div class="uno-ranks">' + rows + '</div>' +
          '<p class="uno-ch-sub">计分：数字牌=面值，功能牌=20，万能=50</p>' +
          '<button class="uno-act yes" data-action="restart">再来一局</button>' +
          '</div></div>';
      }
      return '';
    }

    setupHTML() {
      let counts = '';
      for (let k = MIN_PLAYERS; k <= MAX_PLAYERS; k++) counts += '<button class="uno-set-btn' + (this.setupCount === k ? ' on' : '') + '" data-action="setup-count" data-n="' + k + '">' + k + '人</button>';
      let modes = '';
      modes += '<button class="uno-set-btn' + (this.setupMode === 0 ? ' on' : '') + '" data-action="setup-mode" data-m="0">普通叠加</button>';
      modes += '<button class="uno-set-btn' + (this.setupMode === 1 ? ' on' : '') + '" data-action="setup-mode" data-m="1">逆转叠加</button>';
      return '<div class="uno uno-setup">' +
        '<button class="uno-back" data-action="back">‹ 返回</button>' +
        '<h2 class="uno-title">UNO</h2>' +
        '<p class="uno-set-tip">4 - 8 人 · 6 分钟限时 · 你 vs 机器人</p>' +
        '<div class="uno-set-block"><div class="uno-set-label">人数</div><div class="uno-set-row">' + counts + '</div></div>' +
        '<div class="uno-set-block"><div class="uno-set-label">模式</div><div class="uno-set-row">' + modes + '</div></div>' +
        '<p class="uno-set-tip">出牌前若手牌剩 2 张，点 UNO! 喊牌；被加牌时可叠加 +2/+4（逆转叠加模式还能用同色反转丢回）。</p>' +
        '<button class="uno-start-btn" data-action="start">开始游戏</button>' +
        '</div>';
    }

    // ===================== 事件分发 =====================
  onClick(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    switch (a) {
      case 'card': this.onHandCardClicked(parseInt(el.dataset.idx, 10)); break;
      case 'draw': if (this.drawPlayIdx == null) this.onDrawClicked(); break;
      case 'uno': this.onUnoButtonPressed(); break;
      case 'hammer': this.onHammerClicked(parseInt(el.dataset.idx, 10)); break;
      case 'color': this.onColorPicked(el.dataset.color); break;
      case 'challenge': this.onChallengeDecision(el.dataset.v === '1'); break;
      case 'draw-yes': this.onDrawPlayYes(); break;
      case 'draw-no': this.onDrawPlayNo(); break;
      case 'setup-count': this.setupCount = parseInt(el.dataset.n, 10); this.render(); break;
      case 'setup-mode': this.setupMode = parseInt(el.dataset.m, 10); this.render(); break;
      case 'start': this.startMatch(); break;
      case 'restart': this.phase = 'setup'; this.render(); break;
      case 'back': { const b = document.getElementById('game-back'); if (b) b.click(); break; }
      case 'fullscreen': this.tryFullscreen(); break;
    }
  }
  }

  // ===================== 模块注册 =====================
  window.GameModules = window.GameModules || {};
  let instance = null;
  window.GameModules.uno = {
    mount(c, opts) { instance = new UnoGame(c, opts); return instance; },
    unmount() { if (instance) instance.destroy(); instance = null; }
  };
})();
