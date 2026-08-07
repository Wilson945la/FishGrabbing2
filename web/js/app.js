(() => {
  'use strict';

  // ===================== 屏幕路由 =====================
  const screens = {
    login: document.getElementById('screen-login'),
    home: document.getElementById('screen-home'),
    game: document.getElementById('screen-game'),
    me: document.getElementById('screen-me'),
    msg: document.getElementById('screen-msg'),
    friends: document.getElementById('screen-friends'),
  };
  const ordered = ['login', 'home', 'game', 'me', 'msg', 'friends'];
  const history = [];

  function showScreen(name, opts = {}) {
    ordered.forEach((n) => screens[n].classList.toggle('active', n === name));
    // 维护历史用于返回
    if (history[history.length - 1] !== name) history.push(name);
    if (name === 'home') { refreshHome(); syncExitFsBtn(); }
  }

  function goBack() {
    // 离开游戏时先卸载
    if (history[history.length - 1] === 'game' && currentModule && currentModule.unmount) {
      currentModule.unmount();
      currentModule = null;
    }
    history.pop();
    const prev = history[history.length - 1] || 'home';
    ordered.forEach((n) => screens[n].classList.toggle('active', n === prev));
    if (prev === 'home') refreshHome();
  }

  // ===================== 登录/注册（本地模拟） =====================
  const LS_USERS = 'muyu_users';
  const LS_CUR = 'muyu_current';

  function loadUsers() {
    try { return JSON.parse(localStorage.getItem(LS_USERS) || '{}'); }
    catch { return {}; }
  }
  function saveUsers(u) { localStorage.setItem(LS_USERS, JSON.stringify(u)); }
  function getCurrent() {
    try { return JSON.parse(localStorage.getItem(LS_CUR) || 'null'); }
    catch { return null; }
  }
  function setCurrent(u) {
    if (u) localStorage.setItem(LS_CUR, JSON.stringify(u));
    else localStorage.removeItem(LS_CUR);
  }

  const authMsg = document.getElementById('auth-msg');
  function setAuthMsg(text, ok = false) {
    authMsg.textContent = text || '';
    authMsg.classList.toggle('ok', ok);
  }

  // tab 切换
  const segBtns = document.querySelectorAll('.seg-btn');
  const loginForm = document.getElementById('login-form');
  const regForm = document.getElementById('register-form');
  segBtns.forEach((b) => {
    b.addEventListener('click', () => {
      segBtns.forEach((x) => x.classList.toggle('active', x === b));
      const tab = b.dataset.tab;
      loginForm.classList.toggle('hidden', tab !== 'login');
      regForm.classList.toggle('hidden', tab !== 'register');
      setAuthMsg('');
    });
  });

  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const account = document.getElementById('login-account').value.trim();
    const pwd = document.getElementById('login-pwd').value;
    const users = loadUsers();
    if (!users[account]) { setAuthMsg('账号不存在，请先注册'); return; }
    if (users[account].pwd !== pwd) { setAuthMsg('密码错误'); return; }
    setCurrent({ name: users[account].name, account });
    setAuthMsg('登录成功', true);
    setTimeout(() => showScreen('home'), 300);
  });

  regForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('reg-name').value.trim();
    const account = document.getElementById('reg-account').value.trim();
    const pwd = document.getElementById('reg-pwd').value;
    const pwd2 = document.getElementById('reg-pwd2').value;
    if (!name || !account || !pwd) { setAuthMsg('请填写完整信息'); return; }
    if (pwd !== pwd2) { setAuthMsg('两次密码不一致'); return; }
    const users = loadUsers();
    if (users[account]) { setAuthMsg('该账号已被注册'); return; }
    users[account] = { name, pwd };
    saveUsers(users);
    setCurrent({ name, account });
    setAuthMsg('注册成功', true);
    setTimeout(() => showScreen('home'), 300);
  });

  // ===================== 主页 =====================
  function refreshHome() {
    const cur = getCurrent();
    document.getElementById('home-username').textContent = cur ? cur.name : '游客';
  }

  // 猫点击
  const cat = document.getElementById('cat');
  const kaomoji = ['ฅ^••^ฅ', '(=^･ω･^=)', '(=ω①=)', 'ฅ(*д*๑)ฅ', '(=｀ω´=)', 'ฅ(≧ω≦)ฅ'];
  cat.addEventListener('click', () => {
    cat.textContent = kaomoji[Math.floor(Math.random() * kaomoji.length)];
    cat.classList.remove('shake');
    void cat.offsetWidth;
    cat.classList.add('shake');
    setTimeout(() => { cat.textContent = '🐱'; }, 1500);
  });

  // 游戏入口
  let currentModule = null;
  document.querySelectorAll('.game-card').forEach((btn) => {
    btn.addEventListener('click', () => {
      const game = btn.dataset.game;
      openGame(game);
    });
  });

  const mount = document.getElementById('game-mount');
  const gameTitle = document.getElementById('game-title');
  const TITLES = { minesweeper: '扫雷', tetris: '俄罗斯方块', aerochess: '飞行棋', game2048: '2048', uno: 'UNO' };

  function openGame(game) {
    if (!window.GameModules || !window.GameModules[game]) {
      alert('游戏模块未加载: ' + game);
      return;
    }
    mount.innerHTML = '';
    gameTitle.textContent = TITLES[game] || '游戏';
    showScreen('game');
    currentModule = window.GameModules[game];
    currentModule.mount(mount, { user: getCurrent() });
  }

  document.getElementById('game-back').addEventListener('click', goBack);

  // 轻量屏（个人中心 / 消息 / 好友）
  document.getElementById('user-chip').addEventListener('click', openMe);
  document.getElementById('btn-friends').addEventListener('click', () => {
    showScreen('friends');
    renderFriends();
  });
  document.getElementById('btn-msg').addEventListener('click', () => {
    showScreen('msg');
    renderMsg();
  });
  document.getElementById('me-back').addEventListener('click', goBack);
  document.getElementById('msg-back').addEventListener('click', goBack);
  document.getElementById('friends-back').addEventListener('click', goBack);

  // 退出全屏：仅在已处于全屏时显示（好友右侧），点击退出
  const btnExitFs = document.getElementById('btn-exit-fs');
  function syncExitFsBtn() {
    if (!btnExitFs) return;
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement ||
                 document.mozFullScreenElement || document.msFullscreenElement;
    btnExitFs.hidden = !fsEl;
  }
  if (btnExitFs) {
    btnExitFs.addEventListener('click', () => {
      const exit = document.exitFullscreen || document.webkitExitFullscreen ||
                   document.mozCancelFullScreen || document.msExitFullscreen;
      if (exit) { try { exit.call(document); } catch (e) {} }
    });
  }
  document.addEventListener('fullscreenchange', syncExitFsBtn);
  document.addEventListener('webkitfullscreenchange', syncExitFsBtn);
  syncExitFsBtn();

  function openMe() {
    const cur = getCurrent();
    const body = document.getElementById('me-body');
    const accountBtn = cur
      ? `<button class="ghost-btn" id="me-logout">退出登录</button>`
      : `<button class="ghost-btn" id="me-login">登录 / 注册</button>`;
    body.innerHTML = `
      <div class="card">
        <h3>账号信息</h3>
        <div class="row"><span>昵称</span><span>${cur ? cur.name : '游客'}</span></div>
        <div class="row"><span>账号</span><span>${cur ? cur.account : '—'}</span></div>
        <div class="row"><span>状态</span><span>${cur ? '已登录（本地）' : '游客模式'}</span></div>
      </div>
      <div class="card">
        <h3>说明</h3>
        <p style="color:var(--muted);font-size:13px;line-height:1.6;margin:0">
          此为手机版客户端，账号数据保存在本机浏览器。好友 / 消息需连接原服务器，
          当前为离线预览版，相关功能暂以占位展示。
        </p>
      </div>
      <div style="margin-top:18px;display:flex;justify-content:center;">${accountBtn}</div>`;
    if (cur) {
      document.getElementById('me-logout').onclick = () => { setCurrent(null); showScreen('login'); };
    } else {
      document.getElementById('me-login').onclick = () => showScreen('login');
    }
    showScreen('me');
  }

  function renderFriends() {
    const body = document.getElementById('friends-body');
    body.innerHTML = `<p class="me-empty">暂无好友（需连接服务器）</p>`;
  }
  function renderMsg() {
    const body = document.getElementById('msg-body');
    body.innerHTML = `<p class="me-empty">暂无消息（需连接服务器）</p>`;
  }

  // ===================== 离线模式 / 登录入口 =====================
  let offlineOn = false;
  const offlineBtn = document.getElementById('btn-offline');
  offlineBtn.addEventListener('click', () => {
    offlineOn = true;
    offlineBtn.classList.add('on');
    offlineBtn.textContent = '✅ 离线模式已开启 · 选个游戏开玩';
    toast('已进入离线模式，无需联网即可游玩');
  });

  document.getElementById('btn-login').addEventListener('click', () => showScreen('login'));
  document.getElementById('login-back').addEventListener('click', goBack);

  function toast(msg) {
    let t = document.getElementById('toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ===================== 启动 =====================
  // 微信内置浏览器无法直接打开，给出引导
  if (/MicroMessenger/i.test(navigator.userAgent)) {
    const tip = document.getElementById('wechat-tip');
    if (tip) tip.classList.remove('hidden');
  }

  // 手机端默认进入摸鱼中心（离线可玩），登录为可选
  showScreen('home');
})();
