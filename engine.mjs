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

/* =========================================================
   サービス種別プリセット
   scaleFields: 規模入力の定義
   build(s): 職種行を返す [{key,name,std,note,a}]
   ratio: 実配置比率の定義（不要なら null）
   ========================================================= */
var SERVICES = {

  tokuyou: {
    name:"介護老人福祉施設（従来型）", defRev:37000,
    priceBasis:"day", unitPrice:13200, priceLabel:"入所者1人1日あたり収入", annualDays:function(s){ return 365; },
    bench:64.3, benchNote:"全サービス平均を暫定適用（サービス別実数は未取得）",
    note:"入所者3人に対し介護・看護職員1人以上（常勤換算）。看護職員は入所者数に応じた段階配置。",
    fields:[{k:"cap",label:"入所定員",unit:"人",val:80,step:1},
            {k:"occ",label:"稼働率",unit:"％",val:96,step:1}],
    users:function(s){ return s.cap * s.occ / 100; },
    build:function(s){
      var u = this.users(s);
      var kango = u <= 30 ? 1 : u <= 50 ? 2 : u <= 130 ? 3 : 3 + CEIL((u - 130) / 50);
      var core = u / 3, r = u / 80;
      return [
        {key:"chief", name:"施設長",             std:1,               a:W.chief,  note:"常勤専従1"},
        {key:"ishi",  name:"医師（嘱託）",        std:0.1,           a:W.ishi,   note:"必要数・非常勤可"},
        {key:"soudan",name:"生活相談員",          std:Math.max(1,CEIL(u/100)), a:W.soudan, note:"入所者100人に1以上"},
        {key:"kango", name:"看護職員",            std:kango,          a:W.kango,  note:"30以下1／30超50以下2／50超130以下3／130超は50ごとに+1"},
        {key:"kaigo", name:"介護職員",            std:Math.max(0,core-kango), a:W.kaigo, note:"介護＋看護で入所者3人に1（3:1）"},
        {key:"kinou", name:"機能訓練指導員",      std:1,               a:W.kinou,  note:"1以上・兼務可"},
        {key:"cm",    name:"介護支援専門員",      std:Math.max(1,CEIL(u/100)), a:W.cm,  note:"1以上（100:1を標準）・兼務可"},
        {key:"eiyou", name:"管理栄養士・栄養士",  std:1,               a:W.eiyou,  note:"1以上"},
        {key:"chouri",name:"調理員・その他",      std:0,             a:W.chouri, note:"基準なし。給食委託なら0"},
        {key:"jimu",  name:"事務職員",            std:0,             a:W.jimu,   note:"基準なし"}
      ];
    },
    ratio:{ label:"介護・看護職員 対 入所者", roles:["kaigo","kango"], std:3 }
  },

  unit: {
    name:"介護老人福祉施設（ユニット型）", defRev:37000,
    priceBasis:"day", unitPrice:13200, priceLabel:"入所者1人1日あたり収入", annualDays:function(s){ return 365; },
    bench:64.3, benchNote:"全サービス平均を暫定適用（サービス別実数は未取得）",
    note:"3:1に加え、日中は1ユニットに常時1人以上、夜間は2ユニットに1人以上。ユニット常時配置のほうが3:1より重くなる場合があります。",
    fields:[{k:"cap",label:"入所定員",unit:"人",val:80,step:1},
            {k:"occ",label:"稼働率",unit:"％",val:96,step:1},
            {k:"units",label:"ユニット数",unit:"", val:8,step:1}],
    users:function(s){ return s.cap * s.occ / 100; },
    build:function(s){
      var u = this.users(s);
      var kango = u <= 30 ? 1 : u <= 50 ? 2 : u <= 130 ? 3 : 3 + CEIL((u - 130) / 50);
      var core = u / 3, r = u / 80;
      // 日中16時間×常時1人／ユニット ＋ 夜間8時間×1人／2ユニット を週7日回す常勤換算
      var byUnit = (s.units || 1) * (16 + 8/2) * 7 / (s.week || 40);
      return [
        {key:"chief", name:"施設長",            std:1, a:W.chief, note:"常勤専従1"},
        {key:"ishi",  name:"医師（嘱託）",       std:0.1, a:W.ishi, note:"必要数・非常勤可"},
        {key:"soudan",name:"生活相談員",         std:Math.max(1,CEIL(u/100)), a:W.soudan, note:"入所者100人に1以上"},
        {key:"kango", name:"看護職員",           std:kango, a:W.kango, note:"段階配置"},
        {key:"kaigo", name:"介護職員",           std:Math.max(0, Math.max(core, byUnit) - kango), a:W.kaigo,
                      note:"3:1と、ユニット常時配置に要する数の大きい方。後者は日中16h×1人／U＋夜間8h×1人／2Uを週7日で換算した目安（未検証）"},
        {key:"kinou", name:"機能訓練指導員",     std:1, a:W.kinou, note:"1以上・兼務可"},
        {key:"cm",    name:"介護支援専門員",     std:Math.max(1,CEIL(u/100)), a:W.cm, note:"1以上・兼務可"},
        {key:"eiyou", name:"管理栄養士・栄養士", std:1, a:W.eiyou, note:"1以上"},
        {key:"chouri",name:"調理員・その他",     std:0, a:W.chouri, note:"基準なし。給食委託なら0"},
        {key:"jimu",  name:"事務職員",           std:0, a:W.jimu, note:"基準なし"}
      ];
    },
    ratio:{ label:"介護・看護職員 対 入所者", roles:["kaigo","kango"], std:3 }
  },

  roken: {
    name:"介護老人保健施設", defRev:48000,
    priceBasis:"day", unitPrice:14300, priceLabel:"入所者1人1日あたり収入", annualDays:function(s){ return 365; },
    bench:64.3, benchNote:"全サービス平均を暫定適用（サービス別実数は未取得）",
    note:"看護・介護で3:1、うち看護2/7・介護5/7が標準。医師は入所者100人に1人以上（常勤1以上）。",
    fields:[{k:"cap",label:"入所定員",unit:"人",val:100,step:1},
            {k:"occ",label:"稼働率",unit:"％",val:92,step:1}],
    users:function(s){ return s.cap * s.occ / 100; },
    build:function(s){
      var u = this.users(s), core = u / 3, r = u / 92;
      return [
        {key:"chief", name:"管理者（施設長）",   std:1, a:W.chief, note:"常勤1"},
        {key:"ishi",  name:"医師",               std:Math.max(1,u/100), a:W.ishi, note:"入所者100人に1以上・常勤1以上"},
        {key:"kango", name:"看護職員",           std:core*2/7, a:W.kango, note:"看護・介護3:1のうち看護2/7が標準"},
        {key:"kaigo", name:"介護職員",           std:core*5/7, a:W.kaigo, note:"同うち介護5/7が標準"},
        {key:"soudan",name:"支援相談員",         std:Math.max(1,CEIL(u/100)), a:W.soudan, note:"1以上（100:1）"},
        {key:"pt",    name:"PT・OT・ST",         std:Math.max(1,u/100), a:W.pt, note:"入所者100人に1以上"},
        {key:"cm",    name:"介護支援専門員",     std:Math.max(1,CEIL(u/100)), a:W.cm, note:"1以上（100:1）"},
        {key:"eiyou", name:"管理栄養士・栄養士", std:(s.cap>=100)?1:0, a:W.eiyou, note:"入所定員100以上で1以上"},
        {key:"yakuzai",name:"薬剤師",            std:0.2, a:W.yakuzai, note:"実情に応じた適当数"},
        {key:"chouri",name:"調理員・その他",     std:0, a:W.chouri, note:"基準なし。給食委託なら0"},
        {key:"jimu",  name:"事務職員",           std:0, a:W.jimu, note:"基準なし"}
      ];
    },
    ratio:{ label:"看護・介護職員 対 入所者", roles:["kaigo","kango"], std:3 }
  },

  tsuusho: {
    name:"通所介護", defRev:7700,
    priceBasis:"day", unitPrice:8010, priceLabel:"利用者1人1日あたり収入", annualDays:function(s){ return (s.days || 6) * 52; },
    bench:64.3, benchNote:"全サービス平均を暫定適用（サービス別実数は未取得）",
    note:"介護職員は利用者15人まで1以上、15人を超える部分は5人ごとに1を加えた数を、提供時間帯を通じて配置。常勤換算への換算は営業日数と提供時間に左右されます。",
    fields:[{k:"cap",label:"1日あたり利用定員",unit:"人",val:35,step:1},
            {k:"occ",label:"稼働率",unit:"％",val:88,step:1},
            {k:"hours",label:"1日のサービス提供時間",unit:"時間",val:7,step:0.5},
            {k:"days",label:"週の営業日数",unit:"日",val:6,step:1}],
    users:function(s){ return s.cap * s.occ / 100; },
    build:function(s){
      var u = this.users(s), r = u / 30.8;
      var need = u <= 15 ? 1 : 1 + (u - 15) / 5;
      var f = (s.hours * s.days) / (s.week || 40);
      return [
        {key:"chief", name:"管理者",           std:1, a:W.chief, note:"常勤専従1（兼務可）"},
        {key:"soudan",name:"生活相談員",       std:f, a:W.soudan, note:"提供時間帯を通じて専従1以上"},
        {key:"kaigo", name:"介護職員",         std:need*f, a:W.kaigo,
                      note:"15人まで1、超過分5人ごとに+1を提供時間帯を通じて。常勤換算＝必要員数×(提供時間×営業日数)÷週所定労働時間"},
        {key:"kango", name:"看護職員",         std:f, a:W.kango, note:"1以上（定員10人以下は不要・兼務や緩和の規定あり）"},
        {key:"kinou", name:"機能訓練指導員",   std:0.5, a:W.kinou, note:"1以上・兼務可（目安値）"},
        {key:"unten", name:"送迎・調理・事務", std:0, a:W.jimu, note:"基準なし"}
      ];
    },
    ratio:{ label:"介護・看護職員 対 利用者（常勤換算）", roles:["kaigo","kango"], std:null }
  }

};
  /* ---------- 純粋な計算 ---------- */
  function annualMult(svc, sizes, week){
    if (svc.priceBasis !== "day") return 12;
    var s = {}; for (var k in sizes) s[k] = sizes[k];
    s.week = week;
    return svc.annualDays(s);
  }

  function buildStandard(svcKey, sizes, week){
    var s = {}; for (var k in sizes) s[k] = sizes[k];
    s.week = week;
    return SERVICES[svcKey].build(s);
  }

  /* 入力 I（DOM非依存）から、画面に出す全数値を計算して返す。
     I = { service, sizes, week, mode, autoRev, price, rev, ratio, total,
           fuku, bonus, hiW, scale, nminAuto, nminManual, atgt,
           rows:[{key,name,note,n,hi,a}] }                            */
  function calcState(I){
    var svc = SERVICES[I.service];
    var sz = {}; for (var q in I.sizes) sz[q] = I.sizes[q];
    sz.week = I.week;

    var users = svc.users(sz);
    var stdRows = svc.build(sz);
    var stdMap = {}, noteMap = {};
    stdRows.forEach(function(r){ stdMap[r.key] = r.std; noteMap[r.key] = r.note; });

    var scale = I.scale, hw = I.hiW / 100;
    var rows = I.rows.map(function(r){
      return {
        key:r.key, name:r.name,
        note: (noteMap[r.key] != null ? noteMap[r.key] : r.note),
        std:  (stdMap[r.key]  != null ? stdMap[r.key]  : null),
        n:  Math.max(0, r.n  || 0),
        hi: Math.max(0, r.hi || 0)
      };
    });

    /* 原資 */
    var rev = (I.autoRev && I.mode === "ratio")
      ? users * I.price * annualMult(svc, I.sizes, I.week) / 10000
      : I.rev;
    var total = (I.mode === "ratio") ? rev * I.ratio / 100 : I.total;
    var pool  = total / (1 + I.fuku / 100);

    /* 人数と賃金
       v0.4: 職種別の基準年収を廃止。給与原資 pool を全員に均一に配り、非正規は
       正規の hw 倍とする。avgSe*(nSe+hw*nHi)=pool を満たす avgSe が正規の平均年収。
       職種間の配分（v0.3 の賃金倍率 k）は主題（総額は配分に依らない）と無関係なため削除。 */
    var baseS = 0, baseH = 0, stdN = 0;
    rows.forEach(function(r){
      baseS += r.n; baseH += r.hi; stdN += (r.std || 0);
    });
    var baseN = baseS + baseH;
    var n    = baseN * scale, nSe = baseS * scale, nHi = baseH * scale;
    var avg   = n   > 0 ? pool / n : 0;
    var wUnits = nSe + hw * nHi;                 // 正規換算の重み合計
    var avgSe = wUnits > 0 ? pool / wUnits : 0;  // 正規の平均年収
    var avgHi = avgSe * hw;                       // 非正規の平均年収

    rows.forEach(function(r){
      r.totalFte  = (r.n + r.hi) * scale;
    });

    /* 職種別の基準充足 */
    var sMin = 0, blocked = null, shorts = [];
    rows.forEach(function(r){
      if (!r.std || r.std <= 0) return;
      if (r.totalFte < r.std - 1e-9) shorts.push({ name:r.name, gap:r.std - r.totalFte });
      var tot = r.n + r.hi;
      if (tot <= 0){ blocked = r.name; return; }
      var need = r.std / tot;
      if (need > sMin) sMin = need;
    });
    var nMinComp = blocked ? Infinity : baseN * sMin;
    var nmin = I.nminAuto
      ? (isFinite(nMinComp) ? Math.ceil(nMinComp * 10) / 10 : stdN)
      : I.nminManual;

    /* 配置比率（雇用形態を問わず合計で数える） */
    var coreN = 0;
    if (svc.ratio) rows.forEach(function(r){
      if (svc.ratio.roles.indexOf(r.key) >= 0) coreN += r.totalFte;
    });
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
    var needRevV   = I.ratio > 0 ? needTotal / (I.ratio / 100) : 0;
    var gapPt   = needRatioV - effRatio;              // >0 なら人件費の内側で解けない
    var gapRev  = (rev > 0 && I.ratio > 0) ? needRevV - rev : 0; // 収入をいくら増やすか
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

    /* 限界トレードオフ */
    var up = 10, f1 = 1 + I.fuku / 100;
    var needMoreTotal = n * up * f1;
    var hiNow = n > 0 ? nHi / n : 0, hiNew = Math.min(1, hiNow + 0.10);
    /* 非正規率を +10pt したときの重み係数（正規換算1人あたりコスト）。基準年収に依らない。 */
    var Cnow = (1 - hiNow) + hiNow * hw;
    var Cnew = (1 - hiNew) + hiNew * hw;
    /* 人数を保ったまま非正規率を上げたときの正規平均年収（新式）。 */
    var wUnits2 = n * ((1 - hiNew) + hw * hiNew);
    var avgSe2  = wUnits2 > 0 ? pool / wUnits2 : 0;
    var marg = {
      perPerson: n > 0 ? pool / n - pool / (n + 1) : 0,
      needMoreTotal: needMoreTotal,
      cutN: (avg + up) > 0 ? n - pool / (avg + up) : 0,
      ptUp: rev > 0 ? needMoreTotal / rev * 100 : 0,
      revUp: I.ratio > 0 ? needMoreTotal / (I.ratio / 100) : 0,
      hiNow: hiNow * 100, hiNew: hiNew * 100,
      dN: Cnew > 0 ? n * (Cnow / Cnew - 1) : 0,
      dAvgSe: avgSe2 - avgSe
    };

    return {
      service:I.service, svcName:svc.name, svc:svc, sizes:I.sizes, week:I.week,
      mode:I.mode, autoRev:I.autoRev, price:I.price, scale:scale,
      fuku:I.fuku, bonus:I.bonus, hw:hw, ratioIn:I.ratio, atgt:I.atgt,
      rev:rev, total:total, pool:pool, effRatio:effRatio,
      rows:rows, baseS:baseS, baseH:baseH, baseN:baseN, stdN:stdN,
      n:n, nSe:nSe, nHi:nHi, hiRate: n > 0 ? nHi / n * 100 : 0,
      avg:avg, avgSe:avgSe, avgHi:avgHi, perHead: avg * (1 + I.fuku / 100),
      sMin:sMin, nMinComp:nMinComp, shorts:shorts, blocked:blocked, nmin:nmin,
      slackN: (isFinite(nMinComp) ? n - nMinComp : Infinity),  // 配置の余裕（人）
      slackWage: (I.atgt > 0 ? avg / I.atgt : Infinity),        // 賃金の余裕（倍）
      users:users, coreN:coreN, ratioActual:ratioActual, ratioBad:ratioBad,
      nCap:nCap, feasible:feasible,
      okN: n >= nmin - 1e-9, okA: avg >= I.atgt - 1e-9,
      needPool:needPool, needTotal:needTotal, gap: needTotal - total,
      needRatio: needRatioV, needRev: needRevV,
      gapPt: gapPt, gapRev: gapRev, gapCutN: gapCutN,
      proj: proj, marg:marg
    };
  }

  /* 初期行（実配置＝基準、非正規0）
     基準は 0.1 単位で切り上げて置く（CEIL）。四捨五入だと基準を下回る側に
     丸める職種が生じ（例: 老健の介護 std=21.905 → 21.9）、起動直後に
     「実配置＝基準」と謳いながら 0.0 人不足・下限0.1人割れの矛盾表示が出るため。 */
  function initialRows(svcKey, sizes, week){
    return buildStandard(svcKey, sizes, week).map(function(r){
      return { key:r.key, name:r.name, note:r.note,
               n: Math.ceil((r.std || 0) * 10 - 1e-9) / 10, hi:0 };
    });
  }

  /* 職員数スライダーの倍率を実配置（正規・非正規）に書き戻す。
     scale を残して未スケール値（入力列）とスケール後の値（合計列）を同時に
     画面へ出すと「正規計＋非正規計 ≠ 合計」の矛盾になるため、離した時点で
     ここに畳んで scale を 1 に戻す。常勤換算の粒度に合わせ 0.1 人単位で丸める。 */
  function scaleRows(rows, scale){
    var s = (scale > 0) ? scale : 1;
    return rows.map(function(r){
      var o = {}; for (var k in r) o[k] = r[k];
      o.n  = Math.round((r.n  || 0) * s * 10) / 10;
      o.hi = Math.round((r.hi || 0) * s * 10) / 10;
      return o;
    });
  }

  return { W:W, SERVICES:SERVICES, buildStandard:buildStandard,
           calcState:calcState, initialRows:initialRows,
           scaleRows:scaleRows, annualMult:annualMult };
})();
/* ===== SWMD-ENGINE:END ===== */

export default ENGINE;
export const { SERVICES, buildStandard, calcState, initialRows, scaleRows, annualMult } = ENGINE;
