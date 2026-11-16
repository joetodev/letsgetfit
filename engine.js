/* 規則引擎：用固定規則由動作庫砌出一節運動。唔用網絡、唔用 LLM。
   buildPlan(minutes, goal, settings, seed) → { steps, phases, total }
   step = { kind: 'prep' | 'work', phase, move, side, dur, label, round }
*/
(function (root) {
  var D = (typeof module !== 'undefined') ? require('./data.js') : root;
  var MOVES = D.MOVES;
  var BY_ID = {};
  MOVES.forEach(function (m) { BY_ID[m.id] = m; });

  /* 各目標嘅時間分配（佔總時長比例）。main = 間歇主訓練，rel = 滾筒／球，cd = 伸展緩和 */
  var TEMPLATES = {
    fat:    { wu: 0.15, main: 0.70, rel: 0,    pattern: ['cardio', 'lower', 'cardio', 'core', 'cardio', 'upper'] },
    fascia: { wu: 0.10, main: 0,    rel: 0.55, pattern: [] },
    mixed:  { wu: 0.12, main: 0.45, rel: 0.25, pattern: ['cardio', 'lower', 'core', 'cardio', 'upper'] }
  };
  var WORK = 40, REST = 20;          // 間歇：做 40 秒、休息 20 秒（休息時預告下一個動作）
  var MAX_CIRCUIT = 10;              // 一圈最多 10 個動作，長時間就重複幾圈，易跟

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rnd) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function round30(x) { return Math.max(30, Math.round(x / 30) * 30); }

  /* 規則 1：器材過濾 + 護腕／低衝擊替換 */
  function hasEq(m, s) { return !m.eq || !!(s.eq && s.eq[m.eq]); }
  function resolve(m, s) {
    var guard = 0;
    while (m && guard++ < 3) {
      if (s.wristSafe && m.wrist) { m = m.alt && m.alt.wrist ? BY_ID[m.alt.wrist] : null; continue; }
      if (s.lowImpact && m.impact) { m = m.alt && m.alt.impact ? BY_ID[m.alt.impact] : null; continue; }
      break;
    }
    return (m && hasEq(m, s)) ? m : null;
  }
  function pool(cat, s) {
    var seen = {}, out = [];
    MOVES.forEach(function (m) {
      if (m.cat !== cat) return;
      var r = resolve(m, s);
      if (r && r.cat === cat && !seen[r.id]) { seen[r.id] = 1; out.push(r); }
      else if (r && r.cat !== cat && !seen[r.id] && cat !== 'wu') { seen[r.id] = 1; out.push(r); }
    });
    return out;
  }
  /* 按優先級分層，層內隨機 */
  function byPriority(list, rnd) {
    var tiers = {};
    list.forEach(function (m) { var p = m.pri == null ? 2 : m.pri; (tiers[p] = tiers[p] || []).push(m); });
    var out = [];
    Object.keys(tiers).sort(function (a, b) { return a - b; }).forEach(function (k) {
      out = out.concat(shuffle(tiers[k], rnd));
    });
    return out;
  }

  /* 規則 2：用「時間預算」填滿一個階段。
     每個動作成本 = 準備秒數 + 動作秒數（分左右就 ×2）。
     填到放唔落為止，餘數平均分返落每個動作，所以總時間一定啱。 */
  function fill(cands, budget, dur, gap, phase, sortByOrder) {
    if (!cands.length || budget <= 0) return [];
    var chosen = [], cost = 0, units = 0, pass = 0, guard = 0;
    function c(m) { return (m.sides ? 2 : 1) * (gap + dur); }
    while (guard++ < 6) {
      var added = false, before = chosen.length;
      for (var i = 0; i < cands.length; i++) {
        var m = cands[i], cc = c(m), u = m.sides ? 2 : 1;
        if (cost + cc <= budget) { chosen.push({ m: m, pass: pass }); cost += cc; units += u; added = true; }
        else if ((cost + cc - budget) / (units + u) <= dur * 0.15) {
          chosen.push({ m: m, pass: pass }); cost += cc; units += u; guard = 99; break;
        }
      }
      if (!added || guard >= 99 || chosen.length - before < cands.length) break;
      pass++;                                   // 動作庫用晒就開第二輪
    }
    if (!chosen.length) { chosen.push({ m: cands[0], pass: 0 }); cost = c(cands[0]); units = cands[0].sides ? 2 : 1; }
    function ps(x) { return (x.m.order || 0) >= 99 ? 99 : x.pass; }     // 呼吸收尾永遠排最後
    if (sortByOrder) chosen.sort(function (a, b) { return (ps(a) - ps(b)) || ((a.m.order || 0) - (b.m.order || 0)); });

    var delta = budget - cost, each = Math.floor(delta / units), extra = delta - each * units;
    var steps = [];
    chosen.forEach(function (ch) {
      var sides = ch.m.sides ? ['左', '右'] : [null];
      sides.forEach(function (side, si) {
        steps.push({ kind: 'prep', phase: phase, move: ch.m.id, side: side, dur: gap, label: si === 1 ? '換邊' : '準備' });
        steps.push({ kind: 'work', phase: phase, move: ch.m.id, side: side, dur: dur + each + (extra-- > 0 ? 1 : 0) });
      });
    });
    return steps;
  }

  /* 規則 3：間歇主訓練。跟 pattern 輪流揀類別；手腕受力動作唔連續、全節限量；跳躍動作限量 */
  function circuit(tpl, rounds, s, rnd) {
    var sets = Math.ceil(rounds / MAX_CIRCUIT);
    var k = Math.ceil(rounds / sets);
    var pools = {};
    ['cardio', 'lower', 'core', 'upper'].forEach(function (c) { pools[c] = shuffle(pool(c, s), rnd); });
    var wristMax = Math.max(1, Math.floor(k / 4)), impactMax = Math.max(1, Math.floor(k / 5));
    var wristN = 0, impactN = 0, prev = null, picked = [], used = {};
    for (var i = 0; i < k; i++) {
      var cat = tpl.pattern[i % tpl.pattern.length];
      var order = [cat, 'cardio', 'lower', 'core'];           // 該類別冇動作可揀就向後補
      var m = null;
      for (var o = 0; o < order.length && !m; o++) {
        var p = pools[order[o]];
        for (var j = 0; j < p.length; j++) {
          var x = p[j];
          if (used[x.id]) continue;
          if (x.wrist && (wristN >= wristMax || (prev && prev.wrist))) continue;
          if (x.impact && (impactN >= impactMax || (prev && prev.impact))) continue;
          m = x; break;
        }
      }
      if (!m) { used = {}; m = pools.cardio[i % pools.cardio.length]; }
      used[m.id] = 1; if (m.wrist) wristN++; if (m.impact) impactN++;
      picked.push(m); prev = m;
    }
    var steps = [];
    for (var r = 0; r < rounds; r++) {
      var mv = picked[r % k], setNo = Math.floor(r / k) + 1;
      var tag = sets > 1 ? ('第 ' + setNo + '/' + sets + ' 圈') : null;
      steps.push({ kind: 'prep', phase: 'main', move: mv.id, side: null, dur: REST, label: r === 0 ? '準備' : '休息', round: tag });
      steps.push({ kind: 'work', phase: 'main', move: mv.id, side: null, dur: WORK, round: tag });
    }
    return steps;
  }

  function buildPlan(minutes, goal, settings, seed) {
    var s = settings || {}, T = minutes * 60, tpl = TEMPLATES[goal] || TEMPLATES.mixed;
    var rnd = mulberry32((seed || 1) * 2654435761 >>> 0);

    var wuB = round30(T * tpl.wu);
    var rounds = tpl.main ? Math.round((T * tpl.main) / (WORK + REST)) : 0;
    if (goal === 'fat') rounds = Math.floor((T - 2 * wuB) / (WORK + REST));
    var mainB = rounds * (WORK + REST);
    var relPool = byPriority(pool('rel', s), rnd);
    var relB = relPool.length ? Math.round(T * tpl.rel) : 0;      // 冇滾筒／球：時間全部撥去伸展
    var cdB = T - wuB - mainB - relB;

    /* 暖身：有主訓練先做手腕暖身；筋膜日唔需要 */
    var wuPool = byPriority(pool('wu', s), rnd).filter(function (m) { return !(goal === 'fascia' && m.id === 'wristprep'); });
    var steps = []
      .concat(fill(wuPool, wuB, 25, 5, 'wu', false))
      .concat(rounds ? circuit(tpl, rounds, s, rnd) : [])
      .concat(fill(relPool, relB, 45, 8, 'rel', true))
      .concat(fill(byPriority(pool('st', s), rnd), cdB, cdB < 150 ? 20 : 30, 5, 'cd', true));

    var phases = [], total = 0;
    steps.forEach(function (st, i) {
      st.start = total; total += st.dur; st.index = i;
      var last = phases[phases.length - 1];
      if (!last || last.id !== st.phase) phases.push({ id: st.phase, dur: st.dur, start: st.start });
      else last.dur += st.dur;
    });
    return { steps: steps, phases: phases, total: total, minutes: minutes, goal: goal };
  }

  var api = { buildPlan: buildPlan, BY_ID: BY_ID, pool: pool };
  if (typeof module !== 'undefined') module.exports = api; else root.Engine = api;
})(typeof window !== 'undefined' ? window : this);
