/* 自動生成 — 直接編集しないこと。生成元: jinkenhi-sim.html */
/* ===== SWMD-ENGINE:BEGIN =====
   DOMに触れない純粋な計算層。tools/extract-engine.mjs がこの区間だけを
   engine.mjs として抜き出し、tests/ から import して検証する。
   この区間に document / window / $ / num を書かないこと。
   ===== */
var ENGINE = (function(){
  "use strict";

var W = {
  chief:600, jimu:340, soudan:400, kaigo:370, kango:460, kinou:440,
  eiyou:390, chouri:300, cm:430, ishi:1800, pt:450, yakuzai:600
};
var CEIL = function(v){ return Math.ceil(v - 1e-9); };
var R1   = function(v){ return Math.round(v * 10) / 10; };  // 基準を0.1単位に丸める（初期の基準合計＝正規合計を厳密一致させるため）

/* =========================================================
   サービス種別プリセット
   scaleFields: 規模入力の定義
   build(s): 職種行を返す [{key,name,std,note,a}]
   ratio: 実配置比率の定義（不要なら null）
   ========================================================= */
var SERVICES = {

  tokuyou: {
    name:"介護老人福祉施設（従来型）", defRev:37000,
    bench:64.3, benchNote:"全サービス平均を暫定適用（サービス別実数は未取得）",
    note:"入所者3人に対し介護・看護職員1人以上（常勤換算）。看護職員は入所者数に応じた段階配置。",
    fields:[{k:"cap",label:"入所定員",unit:"人",val:80,step:1},
            {k:"occ",label:"稼働率",unit:"％",val:96,step:1}],
    users:function(s){ return s.cap * s.occ / 100; },
    build:function(s){
      var u = this.users(s);
      var kango = u <= 30 ? 1 : u <= 50 ? 2 : u <= 130 ? 3 : 3 + CEIL((u - 130) / 50);
      var core = u / 3, cm100 = Math.max(1, CEIL(u / 100));
      var other = 1 + 0.1 + cm100 + 1 + cm100 + 1;  // 施設長1・医師0.1・生活相談員・機能訓練1・介護支援専門員・管理栄養士1
      return [
        {key:"kaigo", name:"介護職員", std:R1(Math.max(0, core - kango)), note:"介護＋看護で入所者3人に1（3:1）"},
        {key:"kango", name:"看護職員", std:R1(kango), note:"30以下1／30超50以下2／50超130以下3／130超は50ごとに+1"},
        {key:"other", name:"その他職員", std:R1(other),
         note:"施設長1・医師0.1・生活相談員"+cm100+"・機能訓練指導員1・介護支援専門員"+cm100+"・管理栄養士1 の合計"}
      ];
    },
    ratio:{ label:"介護・看護職員 対 入所者", roles:["kaigo","kango"], std:3 }
  },

  unit: {
    name:"介護老人福祉施設（ユニット型）", defRev:37000,
    bench:64.3, benchNote:"全サービス平均を暫定適用（サービス別実数は未取得）",
    note:"3:1に加え、日中は1ユニットに常時1人以上、夜間は2ユニットに1人以上。ユニット常時配置のほうが3:1より重くなる場合があります。",
    fields:[{k:"cap",label:"入所定員",unit:"人",val:80,step:1},
            {k:"occ",label:"稼働率",unit:"％",val:96,step:1},
            {k:"units",label:"ユニット数",unit:"", val:8,step:1}],
    users:function(s){ return s.cap * s.occ / 100; },
    build:function(s){
      var u = this.users(s);
      var kango = u <= 30 ? 1 : u <= 50 ? 2 : u <= 130 ? 3 : 3 + CEIL((u - 130) / 50);
      var core = u / 3, cm100 = Math.max(1, CEIL(u / 100));
      // 日中16時間×常時1人／ユニット ＋ 夜間8時間×1人／2ユニット を週7日回す常勤換算
      var byUnit = (s.units || 1) * (16 + 8/2) * 7 / (s.week || 40);
      var other = 1 + 0.1 + cm100 + 1 + cm100 + 1;
      return [
        {key:"kaigo", name:"介護職員", std:R1(Math.max(0, Math.max(core, byUnit) - kango)),
         note:"3:1と、ユニット常時配置に要する数の大きい方（日中16h×1人／U＋夜間8h×1人／2Uを週7日で換算・未検証）"},
        {key:"kango", name:"看護職員", std:R1(kango), note:"段階配置（30以下1／30超50以下2／50超130以下3／130超は50ごとに+1）"},
        {key:"other", name:"その他職員", std:R1(other),
         note:"施設長1・医師0.1・生活相談員"+cm100+"・機能訓練指導員1・介護支援専門員"+cm100+"・管理栄養士1 の合計"}
      ];
    },
    ratio:{ label:"介護・看護職員 対 入所者", roles:["kaigo","kango"], std:3 }
  },

  roken: {
    name:"介護老人保健施設", defRev:48000,
    bench:64.3, benchNote:"全サービス平均を暫定適用（サービス別実数は未取得）",
    note:"看護・介護で3:1、うち看護2/7・介護5/7が標準。医師は入所者100人に1人以上（常勤1以上）。",
    fields:[{k:"cap",label:"入所定員",unit:"人",val:100,step:1},
            {k:"occ",label:"稼働率",unit:"％",val:92,step:1}],
    users:function(s){ return s.cap * s.occ / 100; },
    build:function(s){
      var u = this.users(s), core = u / 3;
      var ishi = Math.max(1, u / 100), soudan = Math.max(1, CEIL(u / 100)), pt = Math.max(1, u / 100);
      var cm = Math.max(1, CEIL(u / 100)), eiyou = (s.cap >= 100) ? 1 : 0;
      var other = 1 + ishi + soudan + pt + cm + eiyou + 0.2;  // 管理者・医師・支援相談員・PT/OT/ST・介護支援専門員・管理栄養士・薬剤師0.2
      return [
        {key:"kaigo", name:"介護職員", std:R1(core * 5 / 7), note:"看護・介護3:1のうち介護5/7が標準"},
        {key:"kango", name:"看護職員", std:R1(core * 2 / 7), note:"看護・介護3:1のうち看護2/7が標準"},
        {key:"other", name:"その他職員", std:R1(other),
         note:"管理者1・医師"+R1(ishi)+"・支援相談員"+soudan+"・PT/OT/ST"+R1(pt)+"・介護支援専門員"+cm+"・管理栄養士"+eiyou+"・薬剤師0.2 の合計"}
      ];
    },
    ratio:{ label:"看護・介護職員 対 入所者", roles:["kaigo","kango"], std:3 }
  },

  tsuusho: {
    name:"通所介護", defRev:7700,
    bench:64.3, benchNote:"全サービス平均を暫定適用（サービス別実数は未取得）",
    note:"介護職員は利用者15人まで1以上、15人を超える部分は5人ごとに1を加えた数を、提供時間帯を通じて配置。常勤換算への換算は営業日数と提供時間に左右されます。",
    fields:[{k:"cap",label:"1日あたり利用定員",unit:"人",val:35,step:1},
            {k:"occ",label:"稼働率",unit:"％",val:88,step:1},
            {k:"hours",label:"1日のサービス提供時間",unit:"時間",val:7,step:0.5},
            {k:"days",label:"週の営業日数",unit:"日",val:6,step:1}],
    users:function(s){ return s.cap * s.occ / 100; },
    build:function(s){
      var u = this.users(s);
      var need = u <= 15 ? 1 : 1 + (u - 15) / 5;
      var f = (s.hours * s.days) / (s.week || 40);
      var other = 1 + f + 0.5;  // 管理者1・生活相談員f・機能訓練指導員0.5
      return [
        {key:"kaigo", name:"介護職員", std:R1(need * f),
         note:"15人まで1、超過分5人ごとに+1を提供時間帯を通じて（常勤換算＝必要員数×提供時間×営業日数÷週所定労働時間）"},
        {key:"kango", name:"看護職員", std:R1(f), note:"1以上（定員10人以下は不要・兼務や緩和の規定あり）"},
        {key:"other", name:"その他職員", std:R1(other),
         note:"管理者1・生活相談員"+R1(f)+"・機能訓練指導員0.5 の合計（送迎・調理・事務は基準なし）"}
      ];
    },
    ratio:{ label:"介護・看護職員 対 利用者（常勤換算）", roles:["kaigo","kango"], std:null }
  }

};
  /* ---------- 純粋な計算 ---------- */
  /* 年間稼働日数（出力の「1人1日あたり収入」に使う）。通所は営業日数×52週、入所系は365。 */
  function opDaysOf(sizes){ return (sizes && sizes.days != null) ? sizes.days * 52 : 365; }

  function buildStandard(svcKey, sizes, week){
    var s = {}; for (var k in sizes) s[k] = sizes[k];
    s.week = week;
    return SERVICES[svcKey].build(s);
  }

  /* 入力 I（DOM非依存）から、画面に出す全数値を計算して返す。
     収益 rev・人件費総額 total はともに決算書からの実額入力。人件費率は total/rev で出力する。
     hakenFee は total の内数（派遣職員費）。職員給与原資 = (total − hakenFee)/(1+fuku)。
     I = { service, sizes, week, rev, total, hakenFee, fuku, bonus,
           scale, nminAuto, nminManual, atgt, g, rows:[{key,name,note,n,hi,haken}] } */
  function calcState(I){
    var svc = SERVICES[I.service];
    var sz = {}; for (var q in I.sizes) sz[q] = I.sizes[q];
    sz.week = I.week;

    var users = svc.users(sz);
    var stdRows = svc.build(sz);
    var stdMap = {}, noteMap = {};
    stdRows.forEach(function(r){ stdMap[r.key] = r.std; noteMap[r.key] = r.note; });

    var scale = I.scale;
    var rows = I.rows.map(function(r){
      return {
        key:r.key, name:r.name,
        note: (noteMap[r.key] != null ? noteMap[r.key] : r.note),
        std:  (stdMap[r.key]  != null ? stdMap[r.key]  : null),
        n:     Math.max(0, r.n     || 0),   // 正規
        hi:    Math.max(0, r.hi    || 0),   // 非正規
        haken: Math.max(0, r.haken || 0)    // 派遣
      };
    });

    /* 原資（収益・人件費総額ともに決算書からの実額入力）。人件費率は割り算で出力する（v0.4）。
       v0.5: 派遣職員費は人件費総額の内数。職員給与原資は総額から派遣費を除いてから法定福利費を
       割り戻す（派遣費は派遣会社が事業主負担を持つため割り戻さない）。非正規の賃金水準係数は廃止し、
       金額は正規・非正規で分けない（人数は配置判定・正規比率に使う）。 */
    var rev = I.rev, total = I.total, hakenFee = Math.min(Math.max(0, I.hakenFee || 0), total);
    var staffPool = (total - hakenFee) / (1 + I.fuku / 100);  // 職員給与原資（正規＋非正規の額面原資）
    var opDays  = opDaysOf(sz);
    var unitRev = (users > 0 && opDays > 0) ? rev * 10000 / (users * opDays) : 0; // 1人1日あたり収入（出力）

    var baseS = 0, baseH = 0, baseK = 0, stdN = 0;
    rows.forEach(function(r){
      baseS += r.n; baseH += r.hi; baseK += r.haken; stdN += (r.std || 0);
    });
    var staffBase = baseS + baseH, fteBase = staffBase + baseK;
    var nSe = baseS * scale, nHi = baseH * scale, nHk = baseK * scale;
    var staffN = staffBase * scale;   // 職員数（正規＋非正規）
    var fteAll = fteBase * scale;      // 常勤換算合計（派遣込み・配置基準に使う）
    var n = staffN, pool = staffPool;  // グラフ・成立判定の人数と原資は「職員」（段階2で配置比率軸へ）
    var A = fteAll > 0 ? total / fteAll : 0;                          // 1人あたり給与費（派遣込み・事業主負担込み）
    var B = staffN > 0 ? staffPool / staffN : 0;                      // 職員1人あたり給与費（額面）
    var avg = B;                                                     // 既存 chart/verdict 等の「平均年収」＝ B
    var hakenUnit = nHk > 0 ? hakenFee / nHk : 0;                     // 派遣1人あたり費用
    var staffUnitCost = staffN > 0 ? (total - hakenFee) / staffN : 0; // 職員1人あたり人件費（事業主負担込み）
    var regRatio = staffN > 0 ? nSe / staffN * 100 : 0;              // 正規比率（正規÷職員）

    rows.forEach(function(r){
      r.totalFte  = (r.n + r.hi + r.haken) * scale;  // 配置は派遣込み
    });

    /* 職種別の基準充足 */
    var sMin = 0, blocked = null, shorts = [];
    rows.forEach(function(r){
      if (!r.std || r.std <= 0) return;
      if (r.totalFte < r.std - 1e-9) shorts.push({ name:r.name, gap:r.std - r.totalFte });
      var tot = r.n + r.hi + r.haken;
      if (tot <= 0){ blocked = r.name; return; }
      var need = r.std / tot;
      if (need > sMin) sMin = need;
    });
    var nMinComp = blocked ? Infinity : fteBase * sMin;
    var nmin = I.nminAuto
      ? (isFinite(nMinComp) ? Math.ceil(nMinComp * 10) / 10 : stdN)
      : I.nminManual;

    /* 配置比率（雇用形態を問わず合計で数える）。coreN は核職種（介護・看護）の常勤換算合計
       （派遣込み）。coreStaff は核の職員分（派遣を除く正規＋非正規）で、配置比率を動かしたとき
       Bの分母（職員数）がどう動くかを出すのに使う（§3/§4）。 */
    var coreN = 0, coreStaff = 0;
    if (svc.ratio) rows.forEach(function(r){
      if (svc.ratio.roles.indexOf(r.key) >= 0){ coreN += r.totalFte; coreStaff += (r.n + r.hi) * scale; }
    });
    var otherStaff = staffN - coreStaff;   // その他職員（配置比率ドラッグで固定される職員分）
    var ratioActual = (coreN > 0 && users > 0)
      ? (svc.ratio && svc.ratio.invert ? users / coreN : users / coreN) : 0;
    var ratioBad = !!(svc.ratio && svc.ratio.std && !svc.ratio.invert
                      && coreN > 0 && ratioActual > svc.ratio.std + 1e-9);

    /* 成立判定 */
    var nCap      = I.atgt > 0 ? pool / I.atgt : Infinity;
    var feasible  = nmin <= nCap + 1e-9;
    var needPool  = nmin * I.atgt;
    var needTotal = needPool * (1 + I.fuku / 100);
    var effRatio  = rev > 0 ? total / rev * 100 : 0;

    /* 必要人件費率（新機能A）: 譲れない線（配置下限×下回れない平均年収）を守るのに
       必要な人件費率。閾値は置かず符号だけで分岐する。rev>0・atgt>0 で feasible と等価。 */
    var needRatioV = rev > 0 ? needTotal / rev * 100 : 0;
    /* 人件費率（＝effRatio）を変えずに必要総額を賄うのに要る年間収益。 */
    var needRevV   = effRatio > 0 ? needTotal / (effRatio / 100) : 0;
    var gapPt   = needRatioV - effRatio;              // >0 なら人件費の内側で解けない
    var gapRev  = (rev > 0 && effRatio > 0) ? needRevV - rev : 0; // 収入をいくら増やすか
    var gapCutN = isFinite(nCap) ? n - nCap : 0;       // 常勤換算を何人減らすか

    /* 推移（新機能C）: 現行の賃金カーブ（1人あたり人件費の年上昇率 g）を維持した場合の
       人件費率の推移。介護報酬改定・処遇改善加算改定・稼働率の将来変動は織り込まない。 */
    var g = (I.g || 0) / 100;
    function grow(t){ return Math.pow(1 + g, t); }
    var horizons = [3, 5, 10].map(function(t){
      var f = grow(t);
      return { t: t, ratio: effRatio * f, delta: total * (f - 1) };
    });
    var absorbT = 5, fA = grow(absorbT), deltaA = total * (fA - 1);
    var proj = {
      g: I.g || 0,
      horizons: horizons,
      absorb: {
        t: absorbT, delta: deltaA,
        revUp: rev > 0 ? rev * (fA - 1) : 0,   // 収入を増やす（年率 g で rev も伸ばす）
        rate: g * 100,                          // その年率（＝g）
        cutN: n > 0 ? n * (1 - 1 / fA) : 0      // 常勤換算を減らす（t年後の単価で吸収）
      }
    };

    /* 限界トレードオフ（v0.5: 非正規の賃金水準係数を廃したため、金額を正規/非正規で分ける
       トレードオフは削除。人数と原資の関係のみ残す） */
    var up = 10, f1 = 1 + I.fuku / 100;
    var needMoreTotal = n * up * f1;
    var marg = {
      perPerson: n > 0 ? pool / n - pool / (n + 1) : 0,
      needMoreTotal: needMoreTotal,
      cutN: (avg + up) > 0 ? n - pool / (avg + up) : 0,
      ptUp: rev > 0 ? needMoreTotal / rev * 100 : 0,
      revUp: effRatio > 0 ? needMoreTotal / (effRatio / 100) : 0
    };

    return {
      service:I.service, svcName:svc.name, svc:svc, sizes:I.sizes, week:I.week,
      scale:scale,
      fuku:I.fuku, bonus:I.bonus, atgt:I.atgt,
      rev:rev, total:total, hakenFee:hakenFee, pool:pool, effRatio:effRatio, unitRev:unitRev,
      rows:rows, baseS:baseS, baseH:baseH, baseK:baseK, baseN:staffBase, stdN:stdN,
      n:n, nSe:nSe, nHi:nHi, nHk:nHk, staffN:staffN, fteAll:fteAll,
      A:A, B:B, avg:avg,
      hakenUnit:hakenUnit, staffUnitCost:staffUnitCost, regRatio:regRatio,
      sMin:sMin, nMinComp:nMinComp, shorts:shorts, blocked:blocked, nmin:nmin,
      slackN: (isFinite(nMinComp) ? n - nMinComp : Infinity),  // 配置の余裕（人）
      slackWage: (I.atgt > 0 ? avg / I.atgt : Infinity),        // 賃金の余裕（倍）
      users:users, coreN:coreN, coreStaff:coreStaff, otherStaff:otherStaff,
      ratioActual:ratioActual, ratioBad:ratioBad,
      nCap:nCap, feasible:feasible,
      okN: n >= nmin - 1e-9, okA: avg >= I.atgt - 1e-9,
      needPool:needPool, needTotal:needTotal, gap: needTotal - total,
      needRatio: needRatioV, needRev: needRevV,
      gapPt: gapPt, gapRev: gapRev, gapCutN: gapCutN,
      proj: proj, marg:marg
    };
  }

  /* 初期行（実配置＝基準を正規に、非正規・派遣は0）。
     基準 std は build 側で 0.1 単位に丸め済みなので、正規＝std をそのまま置けば
     基準合計＝正規合計 が厳密に一致し（INV-25）、丸めによる幻の不足も出ない。 */
  function initialRows(svcKey, sizes, week){
    return buildStandard(svcKey, sizes, week).map(function(r){
      return { key:r.key, name:r.name, note:r.note, n:(r.std || 0), hi:0, haken:0 };
    });
  }

  /* 職員数スライダーの倍率を実配置（正規・非正規）に書き戻す。
     scale を残して未スケール値（入力列）とスケール後の値（合計列）を同時に
     画面へ出すと「正規計＋非正規計 ≠ 合計」の矛盾になるため、離した時点で
     ここに畳んで scale を 1 に戻す。
     ★丸めない（比例配分をそのまま保持する）。0.1 単位に丸めると、小さい行が
       相対的に切り上がり大きい行が切り下がって職種構成が崩れ、ドラッグを重ねるほど
       配置下限 nMinComp が押し上がる（往復・複数回で顕著）。丸めないことで
       各行の構成比・nMinComp を厳密に保つ。per-row の 正規＋非正規＝合計 は
       n*s + hi*s = (n+hi)*s で厳密に成立する。 */
  function scaleRows(rows, scale){
    var s = (scale > 0) ? scale : 1;
    return rows.map(function(r){
      var o = {}; for (var k in r) o[k] = r[k];
      o.n     = (r.n     || 0) * s;
      o.hi    = (r.hi    || 0) * s;
      o.haken = (r.haken || 0) * s;
      return o;
    });
  }

  /* 配置比率のドラッグ（§3）: 核職種（介護・看護）だけを目標比率 R へ按分する。
     入所者数 users は固定なので、核の常勤換算合計を users/R に合わせる係数で
     核行の n/hi/haken を一律に掛ける。その他職員（roles 外）は触らない（→ INV-24）。
     介護・看護の相互比率と、各行内の正規/非正規/派遣の構成比は係数一律なので厳密に保たれる。
     核が0人・users0・R0 のときは按分できないため素通し（複製のみ返す）。 */
  function scaleCoreToRatio(rows, roles, users, R){
    var curCore = 0;
    rows.forEach(function(r){
      if (roles.indexOf(r.key) >= 0) curCore += (r.n || 0) + (r.hi || 0) + (r.haken || 0);
    });
    var f = (curCore > 0 && users > 0 && R > 0) ? (users / R) / curCore : 1;
    return rows.map(function(r){
      var o = {}; for (var k in r) o[k] = r[k];
      if (roles.indexOf(r.key) >= 0){
        o.n = (r.n || 0) * f; o.hi = (r.hi || 0) * f; o.haken = (r.haken || 0) * f;
      }
      return o;
    });
  }

  /* 配置比率 R のときの職員数（正規＋非正規・派遣除く）。核を R へ按分すると核職員は
     coreStaff×(users/R)/coreN 倍に動き、その他職員 otherStaff は固定なので
     staffN(R) = coreStaff·users/coreN / R + otherStaff = a/R + b。派遣は職員数に含めない。 */
  function staffNAtRatio(c, R){
    if (!(R > 0) || !(c.coreN > 0)) return c.staffN;
    var a = c.coreStaff * c.users / c.coreN, b = c.staffN - c.coreStaff;
    return a / R + b;
  }
  /* 配置比率 R のときの職員1人あたり給与費（額面 B）＝ 給与原資 ÷ 職員数(R)。 */
  function bAtRatio(c, R){ var s = staffNAtRatio(c, R); return s > 0 ? c.pool / s : 0; }

  /* staffNAtRatio の逆写像: 職員数 n（正規＋非正規）を与える配置比率 R。
     n = a/R + b なので R = a/(n − b)。横軸を人数空間にした版（段階2追）で、
     つまみ／ドラッグの目標人数 n を配置比率へ戻して核だけ按分するのに使う。 */
  function ratioAtStaffN(c, n){
    if (!(c.coreN > 0)) return (c.svc.ratio && c.svc.ratio.std) ? c.svc.ratio.std : 1;
    var a = c.coreStaff * c.users / c.coreN, b = c.staffN - c.coreStaff;
    return ((n - b) > 0) ? a / (n - b) : Infinity;
  }

  return { W:W, SERVICES:SERVICES, buildStandard:buildStandard,
           calcState:calcState, initialRows:initialRows, scaleRows:scaleRows,
           scaleCoreToRatio:scaleCoreToRatio, staffNAtRatio:staffNAtRatio, bAtRatio:bAtRatio,
           ratioAtStaffN:ratioAtStaffN };
})();
/* ===== SWMD-ENGINE:END ===== */

export default ENGINE;
export const { SERVICES, buildStandard, calcState, initialRows, scaleRows,
  scaleCoreToRatio, staffNAtRatio, bAtRatio, ratioAtStaffN } = ENGINE;
