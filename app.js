/* 介面同播放器。全部狀態喺記憶體＋localStorage，冇任何網絡請求。 */
(function () {
  'use strict';
  var $app = document.getElementById('app');
  var BY_ID = Engine.BY_ID;
  var PHASE_COLOR = { wu: 'var(--wu)', main: 'var(--main)', rel: 'var(--rel)', cd: 'var(--cd)' };
  var GOALS = {
    fat:    { desc: '低衝擊間歇：做 40 秒、休 20 秒', mix: [['wu', 15], ['main', 70], ['cd', 15]] },
    fascia: { desc: '滾筒＋按摩球慢慢放鬆，再伸展', mix: [['wu', 10], ['rel', 55], ['cd', 35]] },
    mixed:  { desc: '先間歇燃脂，再放鬆繃緊部位', mix: [['wu', 12], ['main', 45], ['rel', 25], ['cd', 18]] }
  };

  /* ── 儲存 ── */
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem('gzj.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('gzj.' + k, JSON.stringify(v)); } catch (e) {} }
  };
  var S = store.get('state', null) || {
    minutes: 15, goal: 'mixed',
    settings: { eq: { roller: true, ball: true, db: true, band: true }, wristSafe: false, lowImpact: false, beep: true, wake: true }
  };
  var reroll = 0, plan = null;
  function save() { store.set('state', S); }
  function seed() { return Math.floor(Date.now() / 864e5) * 31 + reroll * 7 + 1; }   // 每日一組，可手動換

  /* ── 小工具 ── */
  function h(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function mmss(sec) { sec = Math.max(0, Math.round(sec)); return Math.floor(sec / 60) + ':' + ('0' + sec % 60).slice(-2); }
  function show(html, cls) { $app.innerHTML = '<main class="screen ' + (cls || '') + '">' + html + '</main>'; window.scrollTo(0, 0); }
  function on(sel, fn) { [].forEach.call($app.querySelectorAll(sel), function (el) { el.addEventListener('click', function (e) { fn(el, e); }); }); }

  /* 示範畫面：有真人短片（media/<id>.mp4）就播片，冇就用人偶動畫 */
  function mountVisual(el, id, mirror) {
    if ((window.MEDIA_IDS || []).indexOf(id) < 0) return Anim.mount(el, id, mirror);
    el.innerHTML = '<video class="clip' + (mirror ? ' flip' : '') + '" src="media/' + id + '.mp4?v=' + (window.MEDIA_VER || 0) + '" muted loop playsinline autoplay preload="auto"></video>';
    var v = el.firstChild;
    v.muted = true;
    v.addEventListener('error', function () { Anim.mount(el, id, mirror); });      // 片壞咗或者未快取：退返人偶
    var p = v.play(); if (p && p.catch) p.catch(function () {});
  }
  function pauseVisual(yes) {
    Anim.pause(yes);
    [].forEach.call($app.querySelectorAll('video.clip'), function (v) { if (yes) v.pause(); else { var p = v.play(); if (p && p.catch) p.catch(function () {}); } });
  }

  function miniInfo(m) { return '<div class="mini" data-anim="' + m.id + '"></div>' + moveInfo(m); }
  function wireMini() {
    [].forEach.call($app.querySelectorAll('details.row'), function (d) {
      d.addEventListener('toggle', function () {
        var el = d.querySelector('.mini');
        if (d.open) mountVisual(el, el.dataset.anim, false); else el.innerHTML = '';
      });
    });
  }

  function moveInfo(m) {
    var tags = [m.area];
    if (m.eq) tags.push(EQ_LABEL[m.eq]);
    if (m.wrist) tags.push('手腕受力');
    if (m.impact) tags.push('有跳躍');
    return '<div class="info"><ol>' + m.how.map(function (x) { return '<li>' + h(x) + '</li>'; }).join('') + '</ol>' +
      '<dl class="meta"><dt>節奏</dt><dd>' + h(m.tip) + '</dd><dt>注意</dt><dd>' + h(m.caution) + '</dd><dt>修正</dt><dd>' + h(m.mod) + '</dd></dl>' +
      '<div class="tags">' + tags.map(function (t) { return '<span>' + h(t) + '</span>'; }).join('') + '</div></div>';
  }

  /* ── 記錄 ── */
  function weekStats() {
    var hist = store.get('hist', []), d = new Date(); d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    var n = 0, mins = 0;
    hist.forEach(function (x) { if (x.t >= d.getTime()) { n++; mins += x.m; } });
    return { n: n, mins: mins, all: hist.length };
  }

  /* ════════ 主頁 ════════ */
  function home() {
    var st = S.settings, w = weekStats();
    var eqOn = Object.keys(EQ_LABEL).filter(function (k) { return st.eq[k]; }).map(function (k) { return EQ_LABEL[k]; });
    show(
      '<div class="scroll">' +
      '<div class="top"><div><div class="brand">跟住做</div><div class="sub">' + (w.n ? '今個星期 ' + w.n + ' 次 · ' + w.mins + ' 分鐘' : '揀時長同目標，跟住畫面做') + '</div></div>' +
      '<button class="link" data-go="library">動作庫</button></div>' +

      '<div class="label">時長</div><div class="seg">' +
      [10, 15, 30].map(function (m) { return '<button data-min="' + m + '" aria-pressed="' + (S.minutes === m) + '"><b>' + m + '</b><span>分鐘</span></button>'; }).join('') + '</div>' +

      '<div class="label">目標</div><div class="goals">' +
      Object.keys(GOALS).map(function (g) {
        var c = g === 'fat' ? 'var(--main)' : g === 'fascia' ? 'var(--rel)' : 'var(--cd)';
        return '<button class="goal" style="--g:' + c + '" data-goal="' + g + '" aria-pressed="' + (S.goal === g) + '"><h3>' + GOAL_LABEL[g] + '</h3><i class="tick"></i><p>' + GOALS[g].desc + '</p>' +
          '<div class="mix">' + GOALS[g].mix.map(function (x) { return '<i style="flex:' + x[1] + ';background:' + PHASE_COLOR[x[0]] + '"></i>'; }).join('') + '</div></button>';
      }).join('') + '</div>' +

      '<details class="box"><summary>器材同保護設定<small>' + (eqOn.length ? eqOn.join('・') : '徒手') + (st.wristSafe ? '・護腕' : '') + (st.lowImpact ? '・零跳躍' : '') + '</small></summary><div class="opts">' +
      '<div class="chips">' + Object.keys(EQ_LABEL).map(function (k) { return '<button class="chip" data-eq="' + k + '" aria-pressed="' + !!st.eq[k] + '">' + EQ_LABEL[k] + '</button>'; }).join('') + '</div>' +
      toggle('wristSafe', '護腕模式', '完全唔揀手腕撐地嘅動作') +
      toggle('lowImpact', '零跳躍模式', '跑步量大或者腳攰嗰日用') +
      toggle('beep', '嗶聲提示', '最後 3 秒倒數同轉動作時響') +
      toggle('wake', '運動時螢幕長亮', '避免做到一半熄屏') +
      '</div></details>' +
      '</div>' +
      '<div class="dock"><button class="btn" data-go="preview">睇流程</button></div>');

    on('[data-min]', function (el) { S.minutes = +el.dataset.min; save(); home(); });
    on('[data-goal]', function (el) { S.goal = el.dataset.goal; save(); home(); });
    on('[data-eq]', function (el) { S.settings.eq[el.dataset.eq] = !S.settings.eq[el.dataset.eq]; save(); keepOpen(home); });
    on('[data-set]', function (el) { S.settings[el.dataset.set] = !S.settings[el.dataset.set]; save(); keepOpen(home); });
    on('[data-go="preview"]', function () { reroll = 0; preview(); });
    on('[data-go="library"]', library);
  }
  function toggle(key, title, sub) {
    return '<button class="toggle" data-set="' + key + '" aria-pressed="' + !!S.settings[key] + '"><div><b>' + title + '</b><span>' + sub + '</span></div><i class="sw"></i></button>';
  }
  function keepOpen(render) { var y = window.scrollY; render(); var d = $app.querySelector('details.box'); if (d) d.open = true; window.scrollTo(0, y); }

  /* ════════ 流程預覽 ════════ */
  function preview() {
    plan = Engine.buildPlan(S.minutes, S.goal, S.settings, seed());
    var html = '<div class="scroll"><div class="top"><button class="link" data-go="home">‹ 返回</button><button class="link" data-go="reroll">換一組動作</button></div>' +
      '<h1 class="brand">' + S.minutes + ' 分鐘 · ' + GOAL_LABEL[S.goal] + '</h1>' +
      '<div class="pbar">' + plan.phases.map(function (p) { return '<i style="flex:' + p.dur + ';background:' + PHASE_COLOR[p.id] + '"></i>'; }).join('') + '</div>' +
      '<div class="legend">' + plan.phases.map(function (p) { return '<span style="--c:' + PHASE_COLOR[p.id] + '">' + PHASE_LABEL[p.id] + ' ' + mmss(p.dur) + '</span>'; }).join('') + '</div>';
    var cur = null;
    plan.steps.forEach(function (st) {
      if (st.kind !== 'work') return;
      if (st.phase !== cur) {
        cur = st.phase;
        var note = cur === 'main' ? '做 40 秒 · 休 20 秒' : cur === 'rel' ? '慢滾，痛感最多 6/10' : '';
        html += '<div class="ph" style="--c:' + PHASE_COLOR[cur] + '"><span>' + PHASE_LABEL[cur] + '</span><small>' + note + '</small></div>';
      }
      var m = BY_ID[st.move];
      html += '<details class="row"><summary><span class="n">' + h(m.name) + (st.side ? '<span class="badge">' + st.side + '邊</span>' : '') + (st.round ? '<span class="badge">' + st.round + '</span>' : '') +
        '</span><span class="t">' + st.dur + ' 秒</span></summary>' + miniInfo(m) + '</details>';
    });
    html += '</div><div class="dock"><button class="btn" data-go="start">開始</button></div>';
    show(html); wireMini();
    on('[data-go="home"]', home);
    on('[data-go="reroll"]', function () { reroll++; preview(); });
    on('[data-go="start"]', startPlayer);
  }

  /* ════════ 動作庫 ════════ */
  function library() {
    var html = '<div class="scroll"><div class="top"><button class="link" data-go="home">‹ 返回</button><span class="sub">' + MOVES.length + ' 個動作</span></div><h1 class="brand">動作庫</h1>';
    Object.keys(CAT_LABEL).forEach(function (c) {
      var col = c === 'wu' ? 'wu' : c === 'rel' ? 'rel' : c === 'st' ? 'cd' : 'main';
      html += '<div class="ph" style="--c:' + PHASE_COLOR[col] + '"><span>' + CAT_LABEL[c] + '</span></div>';
      MOVES.filter(function (m) { return m.cat === c; }).forEach(function (m) {
        html += '<details class="row"><summary><span class="n">' + h(m.name) + '</span><span class="t">' + h(m.area) + '</span></summary>' + miniInfo(m) + '</details>';
      });
    });
    show(html + '</div>'); wireMini();
    on('[data-go="home"]', home);
  }

  /* ════════ 聲音（本地合成，唔使檔案） ════════ */
  var ac = null;
  function audioInit() {
    try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); } catch (e) { ac = null; }
  }
  function beep(freq, dur, delay) {
    if (!S.settings.beep || !ac) return;
    try {
      var t = ac.currentTime + (delay || 0), o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + dur + 0.05);
    } catch (e) {}
  }

  /* ════════ 螢幕長亮 ════════ */
  var wake = null;
  function wakeOn() {
    if (!S.settings.wake || !navigator.wakeLock) return;
    try { navigator.wakeLock.request('screen').then(function (w) { wake = w; }).catch(function () {}); } catch (e) {}
  }
  function wakeOff() { try { if (wake) wake.release(); } catch (e) {} wake = null; }

  /* ════════ 播放器 ════════ */
  var P = null;
  function startPlayer() {
    audioInit(); wakeOn();
    P = { i: 0, rem: 0, endAt: 0, paused: false, timer: null, lastSec: -1, startedAt: Date.now(), active: 0 };
    show(
      '<div class="top"><button class="x" id="x" aria-label="暫停同離開">✕</button><span class="phase-name" id="phase"></span><span class="left" id="left"></span></div>' +
      '<div class="track" id="track">' + plan.phases.map(function (p) { return '<div style="flex:' + p.dur + '"><i style="--c:' + PHASE_COLOR[p.id] + '"></i></div>'; }).join('') + '</div>' +
      '<div class="count"><span id="count"></span><span id="round"></span></div>' +
      '<div class="stage"><div class="anim" id="anim"></div><div class="state" id="state"></div>' +
      '<div class="clock"><b id="num"></b><span>秒</span></div><div class="drain"><i id="ring"></i></div></div>' +
      '<section class="card" id="card" aria-live="polite"></section>' +
      '<div class="next" id="next"></div>' +
      '<div class="ctrl"><button id="prev">上一個</button><button class="go" id="pp">暫停</button><button id="skip">跳過</button></div>' +
      '<div class="sheet" id="sheet" hidden><div><h2>已暫停</h2><p class="sub" id="sheetsub"></p>' +
      '<button class="btn" id="resume">繼續</button><button class="btn ghost" id="quit">結束今次運動</button></div></div>',
      'player');
    document.getElementById('pp').onclick = function () { pause(true); };
    document.getElementById('x').onclick = function () { pause(true); };
    document.getElementById('resume').onclick = function () { audioInit(); pause(false); };
    document.getElementById('quit').onclick = function () { finish(false); };
    document.getElementById('skip').onclick = function () { audioInit(); go(P.i + 1); };
    document.getElementById('prev').onclick = function () {
      var pair = Math.floor(P.i / 2);                          // 每個動作 = 準備 + 動作
      var st = plan.steps[P.i], into = st.dur - P.rem / 1000;
      go(Math.max(0, ((st.kind === 'work' && into > 4) ? pair : pair - 1) * 2));
    };
    go(0);
    P.timer = setInterval(tick, 100);
  }

  function go(i) {
    if (i >= plan.steps.length) return finish(true);
    var st = plan.steps[i], m = BY_ID[st.move], isPrep = st.kind === 'prep';
    P.i = i; P.rem = st.dur * 1000; P.endAt = Date.now() + P.rem; P.lastSec = -1;
    var scr = $app.querySelector('.screen');
    scr.style.setProperty('--accent', PHASE_COLOR[st.phase]);
    scr.classList.toggle('is-prep', isPrep);
    document.getElementById('phase').textContent = PHASE_LABEL[st.phase];
    document.getElementById('state').textContent = isPrep ? (st.label || '準備') : (st.phase === 'rel' ? '慢慢滾' : st.phase === 'cd' ? '停留・呼吸' : '動作中');
    var works = plan.steps.filter(function (x) { return x.kind === 'work'; }).length;
    document.getElementById('count').textContent = '動作 ' + (Math.floor(i / 2) + 1) + ' / ' + works;
    document.getElementById('round').textContent = st.round || '';
    document.getElementById('card').innerHTML =
      (isPrep ? '<div class="pre">' + (st.label === '換邊' ? '換邊 →' : '下一個 →') + '</div>' : '') +
      '<h2>' + h(m.name) + (st.side ? '<span class="side">' + st.side + '邊</span>' : '') + '</h2>' +
      '<p class="cue">' + h(m.tip) + '</p>' +
      '<details class="more"><summary>做法同修正</summary>' + moveInfo(m) + '</details>';
    var key = st.move + '|' + (st.side || '');
    if (P.animKey !== key) { P.animKey = key; mountVisual(document.getElementById('anim'), st.move, st.side === '右'); }
    var nx = null;
    for (var j = i + 1; j < plan.steps.length; j++) { if (plan.steps[j].kind === 'work' && !(isPrep && j === i + 1)) { nx = plan.steps[j]; break; } }
    document.getElementById('next').innerHTML = nx ? '之後：<b>' + h(BY_ID[nx.move].name) + (nx.side ? '（' + nx.side + '）' : '') + '</b>' : '之後：<b>完成！</b>';
    if (isPrep) beep(440, 0.25); else { beep(880, 0.15); beep(1175, 0.3, 0.16); }
    draw();
  }

  function tick() {
    if (!P || P.paused) return;
    P.rem = P.endAt - Date.now();
    if (P.rem <= 0) { go(P.i + 1); return; }
    draw();
  }

  function draw() {
    var st = plan.steps[P.i], sec = Math.ceil(P.rem / 1000);
    if (sec !== P.lastSec) {
      if (P.lastSec !== -1 && sec <= 3 && sec >= 1) beep(660, 0.09);
      P.lastSec = sec;
      document.getElementById('num').textContent = sec;
      var el = st.start + st.dur - P.rem / 1000;
      document.getElementById('left').textContent = '剩 ' + mmss(plan.total - el);
    }
    var frac = Math.max(0, Math.min(1, P.rem / (st.dur * 1000)));
    document.getElementById('ring').style.width = (frac * 100) + '%';
    var elapsed = st.start + st.dur - P.rem / 1000, segs = document.getElementById('track').children;
    plan.phases.forEach(function (p, k) {
      var f = Math.max(0, Math.min(1, (elapsed - p.start) / p.dur));
      segs[k].firstChild.style.width = (f * 100) + '%';
    });
  }

  function pause(yes) {
    if (!P) return;
    if (yes && !P.paused) { P.rem = P.endAt - Date.now(); P.paused = true; }
    else if (!yes && P.paused) { P.endAt = Date.now() + P.rem; P.paused = false; wakeOn(); }
    var st = plan.steps[P.i];
    document.getElementById('sheetsub').textContent = BY_ID[st.move].name + ' · 剩 ' + Math.ceil(P.rem / 1000) + ' 秒';
    document.getElementById('sheet').hidden = !P.paused;
    pauseVisual(P.paused);
  }
  document.addEventListener('visibilitychange', function () {
    if (!P) return;
    if (document.hidden) pause(true); else wakeOn();          // 切走 App 自動暫停，唔會偷走時間
  });

  function finish(completed) {
    clearInterval(P.timer); wakeOff(); Anim.pause(false);
    var st = plan.steps[Math.min(P.i, plan.steps.length - 1)];
    var doneSec = completed ? plan.total : Math.round(st.start + st.dur - P.rem / 1000);
    var mins = Math.round(doneSec / 60);
    P = null;
    if (completed) { beep(784, 0.18); beep(988, 0.18, 0.2); beep(1319, 0.45, 0.4); }
    if (mins >= 1) { var hist = store.get('hist', []); hist.push({ t: Date.now(), m: mins, g: plan.goal }); store.set('hist', hist.slice(-400)); }
    var w = weekStats(), moves = {};
    plan.steps.forEach(function (x) { if (x.kind === 'work' && (completed || x.start < doneSec)) moves[x.move] = 1; });
    var tipText = plan.goal === 'fat'
      ? '補水，之後 1–2 小時內食啲蛋白質。聽日如果要跑步或踩車，可以揀「筋膜鬆弛」做恢復。'
      : '放鬆後飲啲水，慢慢企返起身。滾完有少少痠係正常，痛就下次減力。';
    show(
      '<div class="scroll" style="display:flex;flex-direction:column;justify-content:center">' +
      '<div class="big">' + mmss(doneSec) + '</div><h1>' + (completed ? '完成！' : '今次到此為止') + '</h1>' +
      '<p class="sub">' + plan.minutes + ' 分鐘 · ' + GOAL_LABEL[plan.goal] + '</p>' +
      '<div class="stats"><div><b>' + Object.keys(moves).length + '</b><span>個動作</span></div><div><b>' + w.n + '</b><span>今星期次數</span></div><div><b>' + w.mins + '</b><span>今星期分鐘</span></div></div>' +
      '<p class="note">' + tipText + '</p></div>' +
      '<div class="dock"><button class="btn" data-go="home">返主頁</button></div>', 'done');
    on('[data-go="home"]', home);
  }

  /* ════════ PWA：註冊 service worker（單檔版本會跳過） ════════ */
  if (!window.__STANDALONE__ && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }

  home();
})();
