import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

/* 画面に出た数値どうしの矛盾を検出する回帰テスト。
   ここに入っている2件は、実際に v0.2 で見つかったバグの型そのものである。 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function open() {
  const dom = new JSDOM(readFileSync(resolve(root, "index.html"), "utf8"),
    { runScripts: "dangerously", pretendToBeVisual: true });
  const d = dom.window.document, Ev = dom.window.Event;
  const fire = (el, t) => el.dispatchEvent(new Ev(t, { bubbles: true }));
  return {
    d,
    set: (id, v) => { const el = d.getElementById(id); el.value = String(v); fire(el, "input"); },
    row: (i, f, v) => { const el = d.querySelectorAll(`[data-i="${i}"][data-f="${f}"]`)[0]; el.value = String(v); fire(el, "input"); },
    svc: (k) => { const s = d.getElementById("svc"); s.value = k; fire(s, "change"); },
    click: (id) => d.getElementById(id).click(),
    num: (id) => parseFloat(d.getElementById(id).textContent.replace(/[^\d.-]/g, "")),
    txt: (sel) => d.querySelector(sel).textContent.replace(/\s+/g, " ").trim()
  };
}

/* 実バグ①: 合計行の「正規計」が合計人数を表示していた
   v0.5: 3行（介護0/看護1/その他2）＋派遣列。合計 = 正規計＋非正規計＋派遣計。 */
test("UI-01 合計行の正規計＋非正規計＋派遣計が合計に一致する", () => {
  const t = open();
  t.row(0, "n", 20); t.row(0, "hi", 11); t.row(1, "n", 3); t.row(1, "haken", 2);
  assert.ok(Math.abs(t.num("f-nbase") + t.num("f-hi") + t.num("f-haken") - t.num("f-n")) < 0.05,
    `正規${t.num("f-nbase")}＋非正規${t.num("f-hi")}＋派遣${t.num("f-haken")} ≠ 合計${t.num("f-n")}`);
});

/* 実バグ②: 配置比率が非正規を数えず、判定と矛盾していた */
test("UI-02 配置比率の警告表示と職種別判定が矛盾しない", () => {
  for (const key of ["tokuyou", "unit", "roken"]) {
    for (const cap of [80, 100, 130]) {
      const t = open();
      t.svc(key);
      t.set("sz-cap", cap);
      const warn = !!t.d.querySelector("#ratiobar .cell.warn");
      const ok = t.txt("#compliance h3").includes("満たしています");
      assert.ok(!(warn && ok), `${key} cap=${cap}: 比率が警告なのに判定は充足`);
    }
  }
});

/* 規模変更で基準未達が検出されること（v0.2 で見落としていた経路） */
test("UI-03 定員だけ増やすと職種別未達が検出される", () => {
  const t = open();
  t.set("sz-cap", 100);
  assert.ok(t.txt("#compliance h3").includes("下回っています"), t.txt("#compliance h3"));
  t.click("fill-std");
  assert.ok(t.txt("#compliance h3").includes("満たしています"), t.txt("#compliance h3"));
});

/* UI-04（規模連動中は収益欄が読み取り専用）は STEP2 再設計で削除。autoRev（規模から収益を
   概算）を廃し、収益は常に実額入力（読み取り専用にしない）ため、この挙動自体が無くなった。 */

/* 全サービスで起動時に例外が出ない */
test("UI-05 全サービスの切り替えで画面が壊れない", () => {
  const t = open();
  for (const key of ["tokuyou", "unit", "roken", "tsuusho"]) {
    t.svc(key);
    assert.ok(t.num("f-n") >= 0, key);
    assert.ok(t.d.querySelectorAll("#chart *").length > 10, `${key} 曲線が描かれていない`);
    assert.ok(!t.txt("#ratiobar").includes("NaN"), `${key} NaN表示`);
  }
});

/* 敵対的レビュー指摘⑤: スライダー操作時の「正規計＋非正規計 ≠ 合計」。
   v0.3 の UI-01 は scale=1 の1点でしか見ておらず、この不整合を捕らえられなかった。
   方針（docs/v0.4-設計.md §9）: スライダーを離した時点で倍率を入力値に書き戻し、
   scale を常に 1 に戻す。未スケール値とスケール後の値が同時に画面に存在する状態をなくす。 */

/* スライダーを value に動かして離す（input→change）。change で確定＝書き戻し。 */
function slide(t, value) {
  const el = t.d.getElementById("scale");
  const Ev = t.d.defaultView.Event;
  el.value = String(value);
  el.dispatchEvent(new Ev("input",  { bubbles: true }));
  el.dispatchEvent(new Ev("change", { bubbles: true }));
}
/* tbody 各行の 正規入力・非正規入力・派遣入力・合計セル を読む（v0.5: 派遣列を追加） */
function rowTriples(t) {
  return [...t.d.querySelectorAll("#tbody tr")].map(tr => ({
    n:     parseFloat(tr.querySelector('[data-f="n"]').value)     || 0,
    hi:    parseFloat(tr.querySelector('[data-f="hi"]').value)    || 0,
    haken: parseFloat(tr.querySelector('[data-f="haken"]').value) || 0,
    tot:   parseFloat((tr.querySelector('[data-c="tot"]').textContent || "").replace(/[^\d.-]/g, "")) || 0
  }));
}

test("UI-06 スライダー操作後は正規計＋非正規計＋派遣計＝合計（合計行・各行とも・全つまみ位置）", () => {
  for (const sc of [0.05, 0.25, 0.5, 0.75, 0.95]) {   // v0.5段2: つまみは配置比率の割合[0,1]
    const t = open();
    // 正規・非正規・派遣を混在させる（介護0を正規20/非正規11、その他2に正規3、看護1に派遣2）
    t.row(0, "n", 20); t.row(0, "hi", 11); t.row(2, "n", 3); t.row(1, "haken", 2);
    slide(t, sc);
    // 合計行: 正規計＋非正規計＋派遣計＝合計（⑤で解消した不整合が再発しないこと）
    assert.ok(Math.abs(t.num("f-nbase") + t.num("f-hi") + t.num("f-haken") - t.num("f-n")) < 0.05,
      `つまみ=${sc}: 正規計${t.num("f-nbase")}＋非正規計${t.num("f-hi")}＋派遣計${t.num("f-haken")}≠合計${t.num("f-n")}`);
    // 各行: 正規＋非正規＋派遣＝合計
    for (const r of rowTriples(t)) {
      assert.ok(Math.abs(r.n + r.hi + r.haken - r.tot) < 0.05,
        `つまみ=${sc}: 行 正規${r.n}＋非正規${r.hi}＋派遣${r.haken}≠合計${r.tot}`);
    }
  }
});

test("UI-07 スライダーは人数軸の割合へ合わせ、その他職員は固定、footerと入力合計が一致する", () => {
  const t = open();
  t.row(0, "n", 20); t.row(0, "hi", 11); t.row(2, "n", 3);  // 介護に正規/非正規、その他に正規3
  const other0 = rowTriples(t)[2];                          // その他行（index2）の初期値
  const E = t.d.defaultView.ENGINE;
  const c0 = stateOf(t);
  // v0.5: つまみは人数空間の割合[0,1]。職員数=fteAll（正規＋非正規＋派遣）。特養は基準3:1域。
  // つまみ0.5 → 目標職員数 = fteAll(4:1)..fteAll(1:1) の中点。ドラッグ先の職員数がその中点に一致すること。
  const nmin = E.fteAllAtRatio(c0, 4), nmax = E.fteAllAtRatio(c0, 1);
  slide(t, 0.5);
  const c = stateOf(t);
  assert.ok(Math.abs(c.n - (nmin + 0.5 * (nmax - nmin))) < 1e-6,
    `職員数が人数軸中点にならない: n=${c.n} 期待=${nmin + 0.5 * (nmax - nmin)}`);
  assert.ok(c.ratioActual > 1 && c.ratioActual < 4, `配置比率が域外: ${c.ratioActual}`);
  // その他職員（index2）は配置比率ドラッグで動かない
  const other1 = rowTriples(t)[2];
  assert.ok(Math.abs(other1.n - other0.n) < 1e-9 && Math.abs(other1.hi - other0.hi) < 1e-9 && Math.abs(other1.haken - other0.haken) < 1e-9,
    `その他職員が動いた: ${JSON.stringify(other0)} → ${JSON.stringify(other1)}`);
  // footer 合計と入力欄の合計（表示 0.1 単位）が一致
  const triples = rowTriples(t);
  const sum = triples.reduce((a, r) => a + r.n + r.hi + r.haken, 0);
  assert.ok(Math.abs(t.num("f-n") - sum) < 0.1 * triples.length,
    `footer合計${t.num("f-n")}≠入力合計${sum.toFixed(1)}`);
});

/* 新機能B（§6）: 定点の位置づけ。起動時（基準ちょうど配置）は警告を出し、
   下回れない平均年収が未入力なら賃金側の判定を伏せる。敵対的レビュー指摘②への対処。 */
test("UI-08 定点の位置づけ：起動時は基準ちょうど警告＋賃金余裕は未入力で伏せる", () => {
  const t = open();
  const anchor = () => t.txt("#anchor");
  assert.ok(anchor().includes("配置が基準ちょうど"), `起動時に基準ちょうど警告なし: ${anchor()}`);
  assert.ok(anchor().includes("賃金の余裕を見るには"), `atgt未入力で賃金余裕を伏せていない: ${anchor()}`);
  // 下回れない平均年収を入力し、全職種を基準超へ増員して基準ちょうどから外す。
  // v0.5段2: 配置比率スライダーは介護・看護しか動かさず その他 が基準ちょうどのまま残るため、
  // 基準ちょうど（全職種で余裕0）を外すには全行を基準超に手入力する。
  t.set("atgt", 450);
  t.row(0, "n", 30); t.row(1, "n", 5); t.row(2, "n", 8);   // 介護・看護・その他すべて基準超へ
  assert.ok(!anchor().includes("配置が基準ちょうど"), `増員後も基準ちょうど警告が残る: ${anchor()}`);
  assert.ok(anchor().includes("賃金の余裕"), `atgt入力後に賃金余裕を出していない: ${anchor()}`);
});

/* 敵対的レビュー後の回帰: ⑤の書き戻し（0.1丸め）で職種構成が崩れ、ドラッグを重ねるほど
   配置下限 nMinComp が押し上がっていた（往復・複数回で顕著）。丸めをやめ比例配分を厳密化。
   ドラッグ確定の前後で nMinComp と各行の構成比が保たれることを固定する。
   INV-21 は「職種別人数を固定したまま」の条件でスライダーを覆っていなかった。 */
function stateOf(t){ return t.d.defaultView.__SWMD_STATE(); }
function slideCommit(t, v){
  const el = t.d.getElementById("scale"), Ev = t.d.defaultView.Event;
  el.value = String(v);
  el.dispatchEvent(new Ev("input", { bubbles: true }));
  el.dispatchEvent(new Ev("change", { bubbles: true }));   // 離して確定
}
/* v0.5段2: 配置比率のロスター断面。核（介護・看護）と その他 を分けて読む。 */
function rosterSnap(t) {
  const c = stateOf(t);
  const roles = c.svc.ratio.roles;
  const core = c.rows.filter(r => roles.includes(r.key));
  const other = c.rows.filter(r => !roles.includes(r.key));
  const tot = r => r.n + r.hi + (r.haken || 0);
  return { c, core, other, tot };
}

test("UI-10 配置比率ドラッグはその他職員を固定し、介護:看護と各行内構成を保つ（単発・往復・複数回）", () => {
  const t = open();
  t.row(0, "hi", 4); t.row(2, "n", 3); t.row(1, "haken", 2);   // 正規/非正規/派遣を混ぜて崩れやすくする
  const s0 = rosterSnap(t);
  const kaigo0 = s0.core.find(r => r.key === "kaigo"), kango0 = s0.core.find(r => r.key === "kango");
  const ratio0 = s0.tot(kaigo0) / s0.tot(kango0);           // 介護:看護
  const comp0 = [kaigo0.n, kaigo0.hi, kaigo0.haken].map(v => v / s0.tot(kaigo0));  // 介護の正規/非正規/派遣構成比
  const check = (tag) => {
    const s = rosterSnap(t);
    // その他職員は不変
    s0.other.forEach(o0 => {
      const o1 = s.other.find(r => r.key === o0.key);
      assert.ok(o1 && Math.abs(o1.n - o0.n) < 1e-9 && Math.abs(o1.hi - o0.hi) < 1e-9 && Math.abs((o1.haken || 0) - (o0.haken || 0)) < 1e-9,
        `${tag}: その他 ${o0.key} が動いた`);
    });
    // 介護:看護 の比が保たれる
    const k1 = s.core.find(r => r.key === "kaigo"), g1 = s.core.find(r => r.key === "kango");
    assert.ok(Math.abs(s.tot(k1) / s.tot(g1) - ratio0) < 1e-9, `${tag}: 介護:看護 の比が変わった`);
    // 介護行内の 正規/非正規/派遣 構成比が保たれる
    [k1.n, k1.hi, k1.haken].map(v => v / s.tot(k1)).forEach((v, i) =>
      assert.ok(Math.abs(v - comp0[i]) < 1e-9, `${tag}: 介護の構成比[${i}] が変わった`));
  };
  slideCommit(t, 0.05); check("薄い端");
  slideCommit(t, 0.95); check("手厚い端");
  slideCommit(t, 0.5); slideCommit(t, 0.333); check("往復");
  for (const f of [0.2, 0.8, 0.4, 0.6, 0.1, 0.9]) { slideCommit(t, f); check(`複数回 f=${f}`); }
});

/* 回帰: つまみを離すと位置が中央に戻る不具合。v0.5段2追 ではつまみ＝現在の職員数の人数軸上割合。
   確定後も現在値を反映して勝手に戻らないこと、他の入力での再描画でも動かないことを固定する。 */
test("UI-11 スライダーのつまみは確定後も現在の職員数を反映し、勝手に戻らない", () => {
  const t = open();
  const knob = () => parseFloat(t.d.getElementById("scale").value);
  const ratio = () => stateOf(t).ratioActual;
  slideCommit(t, 0.7);                     // 手厚い側（右）へドラッグして確定（人数軸割合 0.7）
  const k1 = knob(), r1 = ratio();
  assert.ok(k1 > 0.5, `確定後につまみが左（薄い側）へ戻っている: knob=${k1}`);
  assert.ok(Math.abs(k1 - 0.7) < 0.01, `つまみが操作値0.7を反映していない: ${k1}`);
  t.set("fuku", 17);                        // STEP以外の入力を触って再描画（配置比率・職員数に影響しない）
  assert.ok(Math.abs(knob() - k1) < 0.01, `再描画でつまみが動いた: ${knob()} 期待${k1}`);
  assert.ok(Math.abs(ratio() - r1) < 1e-9, `再描画で配置比率が変わった: ${ratio()} 期待${r1}`);
  t.set("atgt", 500);
  assert.ok(Math.abs(knob() - k1) < 0.01, `再描画でつまみが戻った: ${knob()}`);
});

/* INV-26 バーの位置とグラフの点の横位置が一致する（§3・段2追で人数空間に）。つまみ
   （#scale の値＝人数軸上の割合）と、グラフの琥珀点の横位置（プロット領域内の割合）が
   一致することを実DOMで突合。両者は同じ nFrac から算出される。 */
test("INV-26 バーの位置とグラフの点の横位置が一致する", () => {
  const t = open();
  const VBl = 64, PW = 640 - 64 - 22;   // renderChart の VB.l と プロット幅
  for (const frac of [0.2, 0.5, 0.8]) {
    slide(t, frac);
    const knob = parseFloat(t.d.getElementById("scale").value);
    const pt = t.d.querySelector('#chart [data-o="point"]');
    assert.ok(pt, `frac=${frac}: グラフの点が描かれていない`);
    const cx = parseFloat(pt.getAttribute("cx"));
    const chartFrac = (cx - VBl) / PW;
    assert.ok(Math.abs(knob - chartFrac) < 0.005,
      `frac=${frac}: つまみ位置 ${knob} とグラフ点の横位置 ${chartFrac} が不一致`);
  }
});

/* AXIS-01 横軸が人数（常勤換算）に比例していること（配置比率には比例しない）を固定する。
   上段の配置比率目盛りは、対応する職員数の位置に置くので間隔は不均等になる。
   4:1・3:1・2:1 の画面距離の比が、対応する職員数差の比に一致し、かつ等間隔（比率軸のまま
   なら比=1）ではないことを実DOMで確認する。段2の「比率軸だと双曲線が直線化する」への対処。 */
test("AXIS-01 横軸は人数に比例する（配置比率には比例しない）", () => {
  const t = open();
  const E = t.d.defaultView.ENGINE;
  const c = stateOf(t);
  const xr = (R) => { const el = t.d.querySelector(`#chart [data-r="${R}"]`); return el ? parseFloat(el.getAttribute("x")) : null; };
  const x4 = xr(4), x3 = xr(3), x2 = xr(2);
  assert.ok(x4 != null && x3 != null && x2 != null, `目盛り 4/3/2:1 が描かれていない: ${x4},${x3},${x2}`);
  const n = R => E.fteAllAtRatio(c, R);
  const screenRatio = (x2 - x3) / (x3 - x4);
  const headRatio = (n(2) - n(3)) / (n(3) - n(4));
  assert.ok(Math.abs(screenRatio - headRatio) < 0.02, `画面距離比 ${screenRatio} ≠ 人数差比 ${headRatio}（人数比例でない）`);
  assert.ok(Math.abs(screenRatio - 1) > 0.2, `目盛りが等間隔（比率軸のまま）: 比=${screenRatio}`);
});

/* 職種別内訳テーブルのレイアウトの構成担保（jsdom は実レイアウトを持たないため、
   親幅に追従し狭い幅では横スクロールする CSS 構成を固定する。実ピクセルの欠けなしは
   実機で確認）。table-layout:fixed + width:100% + min-width（狭幅でスクロール）。 */
test("UI-12 職種別内訳テーブルは親幅に追従し、狭幅では横スクロールする構成である", () => {
  const html = readFileSync(resolve(root, "index.html"), "utf8");
  const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
  const tableRule = css.match(/(?:^|\})\s*table\{([^}]*)\}/)[1];
  assert.ok(/width:\s*100%/.test(tableRule), `table が width:100%（親幅追従）でない: ${tableRule}`);
  assert.ok(/min-width:/.test(tableRule), `table に min-width（横スクロール確保）がない: ${tableRule}`);
  assert.ok(/table-layout:\s*fixed/.test(tableRule), `table-layout:fixed でない: ${tableRule}`);
  assert.ok(/\.tbl-scroll\{[^}]*overflow-x:\s*auto/.test(css), ".tbl-scroll に overflow-x:auto がない（切れて隠れる）");
  assert.ok(/(th:first-child,\s*)?td:first-child\{[^}]*text-align:\s*left/.test(css), "職種名列が左寄せでない");
  const t = open();
  assert.equal(t.d.querySelectorAll("#tbl thead th").length, 7, "列数が7（職種・基準・正規・非正規・派遣・合計＋削除列）でない");
});

/* 新機能A（§5）の表示条件を §6 に揃える：必要人件費率は nmin×atgt で計算するため、
   下回れない平均年収が未入力（初期値のまま）だとサンプル値を根拠にした診断になる。
   よって atgt 未入力なら数値を出さず入力を促す。§5と§6で片方だけ出る状態を作らない。 */
test("UI-09 必要人件費率は下回れない平均年収の入力前は数値を出さない（§5/§6整合）", () => {
  const t = open();
  const need = () => t.txt("#need-ratio");
  const anchor = () => t.txt("#anchor");
  const needHasNumber = () => need().includes("必要です");     // 数値状態のみに現れる語
  const anchorHasWage = () => anchor().includes("賃金の余裕："); // 賃金余裕の数値状態
  // 起動直後（atgt未入力）：§5は数値を出さず入力を促す。§6も賃金判定を伏せる。
  assert.ok(!needHasNumber(), `atgt未入力で必要人件費率の数値が出ている: ${need()}`);
  assert.ok(need().includes("下回れない平均年収"), `入力を促していない: ${need()}`);
  assert.equal(needHasNumber(), anchorHasWage(), `§5と§6の表示条件が不一致（未入力時）: need=${needHasNumber()} anchor=${anchorHasWage()}`);
  // atgt入力後：§5は数値を出す。§6も賃金余裕を出す。
  t.set("atgt", 450);
  assert.ok(needHasNumber(), `atgt入力後に必要人件費率の数値が出ていない: ${need()}`);
  assert.equal(needHasNumber(), anchorHasWage(), `§5と§6の表示条件が不一致（入力後）: need=${needHasNumber()} anchor=${anchorHasWage()}`);
});

/* 段3後 修正1: その他職員の不足メッセージに基準の内訳を出す。入力は3行のままで、
   メッセージにエンジンが持つ基準の内訳（施設長・医師・生活相談員…）と合計・入力を併記する。 */
test("UI-13 不足メッセージにその他職員の基準内訳が出る", () => {
  const t = open();
  t.set("sz-cap", 125);                 // 定員125へ（構成据え置き＝その他が基準割れ）
  const html = t.txt("#compliance");
  assert.ok(html.includes("その他職員"), `その他職員の不足が出ていない: ${html}`);
  assert.ok(html.includes("基準の内訳"), `基準の内訳が出ていない: ${html}`);
  // 内訳の職種名（エンジンの note 由来）が含まれる
  for (const role of ["施設長", "医師", "生活相談員", "機能訓練指導員", "介護支援専門員", "管理栄養士"]) {
    assert.ok(html.includes(role), `内訳に「${role}」がない: ${html}`);
  }
  assert.ok(html.includes("入力"), `入力人数の併記がない: ${html}`);
});

/* 段3後 修正2: 基準未達のとき §6 の配置側（配置の余裕）を出さず、充足判定パネルに任せる。
   充足しているとき（余裕が正・ゼロ）だけ「配置の余裕：＋◯人」を出す。「余裕−◯人」は出さない。 */
test("UI-14 §6 配置の余裕は基準未達では出さず、充足時のみ出す", () => {
  const t = open();
  const anchor = () => t.txt("#anchor");
  t.set("sz-cap", 125);                 // 未達を作る
  assert.ok(t.txt("#compliance").includes("下回っています"), `前提: 未達になっていない`);
  assert.ok(!anchor().includes("配置の余裕"), `未達なのに配置の余裕が出ている: ${anchor()}`);
  assert.ok(!anchor().includes("−"), `未達で「−◯人」の表現が残っている: ${anchor()}`);
  t.click("fill-std");                  // 不足を埋めて充足へ
  assert.ok(t.txt("#compliance").includes("満たしています"), `前提: 充足になっていない`);
  assert.ok(anchor().includes("配置の余裕"), `充足時に配置の余裕が出ていない: ${anchor()}`);
});

/* F1対応（段階3の代替）: 「同じジレンマの両面」は g>0 でだけ出す。g=0 は両側とも現在値のため出さず、
   既存の「平坦です」案内を維持する。両側の値は proj.dilemma と一致する。 */
test("UI-15 同じジレンマの両面は g>0 でのみ表示され、値が状態と一致する", () => {
  const f1 = v => (Math.round(v * 10) / 10).toFixed(1);
  const t = open();
  const trend = () => t.txt("#trend");
  // g=0（既定）: 出さない。平坦案内は維持。
  assert.ok(!trend().includes("同じジレンマの両面"), `g=0で両面が出ている: ${trend()}`);
  assert.ok(trend().includes("平坦です"), `g=0の平坦案内がない: ${trend()}`);
  // g>0: 両側の見出しと値が出る。
  t.set("g", 2.5);
  assert.ok(trend().includes("同じジレンマの両面"), `g>0で両面が出ない`);
  assert.ok(trend().includes("人数を保つ場合") && trend().includes("人件費を保つ場合"), `両側の見出しがない`);
  const c = stateOf(t), d = c.proj.dilemma;
  assert.ok(trend().includes(f1(d.keepRatio.n5) + " 人"), `職員数(5)=${f1(d.keepRatio.n5)} 人 が本文にない: ${trend()}`);
  assert.ok(trend().includes("収入横ばい"), `両面が前提（収入横ばい）の適用下にない`);
  // g を 0 に戻すと消える
  t.set("g", 0);
  assert.ok(!trend().includes("同じジレンマの両面"), `g=0に戻して両面が残っている`);
});

/* 水田さん指摘2: 「人件費を保つ場合」の配置比率が法令基準(3:1)を割るとき、朱色で明示する。
   満たすときは警告を出さない。判定は法令基準に対してのみ（閾値は発明しない）。 */
test("UI-16 人件費を保つ側が基準3:1を割ると朱色警告、満たすと出さない", () => {
  const t = open();
  // 特養デフォルト（3:1ちょうど）で g>0 → 人件費を保つと配置が薄くなり基準割れ
  t.set("g", 2.5);
  const c = stateOf(t);
  assert.ok(c.proj.dilemma.keepRatio.breachYear, `前提: この構成で基準割れが起きる`);
  assert.ok(t.txt("#trend").includes("基準 3 : 1 を割ります"), `基準割れの明示がない: ${t.txt("#trend")}`);
  assert.ok(t.d.querySelector("#trend .dwarn"), `朱色の警告行(.dwarn)がない`);
  assert.ok(t.d.querySelector("#trend .warn-badge"), `配置比率の基準割れバッジ(.warn-badge)がない`);
  const yr = c.proj.dilemma.keepRatio.breachYear;
  assert.ok(t.txt("#trend").includes(yr + "年後"), `何年後に割るかの明示がない（${yr}年後）`);

  // 手厚い構成（介護を増員）＋小さめ g → 5年後も 3:1 を割らない → 警告を出さない
  const t2 = open();
  t2.row(0, "n", 60); t2.set("g", 0.5);
  assert.ok(!stateOf(t2).proj.dilemma.keepRatio.breachYear, `前提: 手厚い構成では基準割れしない`);
  assert.ok(!t2.txt("#trend").includes("を割ります"), `基準を満たすのに警告が出ている: ${t2.txt("#trend")}`);
  assert.ok(!t2.d.querySelector("#trend .dwarn"), `満たすのに.dwarnがある`);
  assert.ok(!t2.d.querySelector("#trend .warn-badge"), `満たすのに.warn-badgeがある`);
});

/* v0.5 A統一: 画面上で「職員数」を名乗る表示はすべて同じ値（fteAll＝正規＋非正規＋派遣）を指す。
   派遣を入れて staffN と fteAll がずれる構成でも、バー／footer／グラフ点／雇用区分／両面カードが一致する。 */
test("UI-17 画面の「職員数」を名乗る表示はすべて同一（fteAll）", () => {
  const t = open();
  const f1 = v => (Math.round(v * 10) / 10).toFixed(1);
  t.row(0, "haken", 4); t.row(1, "n", 5); t.set("g", 2.5);   // 派遣を入れ fteAll≠正規非正規に
  const c = stateOf(t), N = c.n;                              // 画面の職員数＝fteAll
  assert.ok(Math.abs(N - (c.nSe + c.nHi + c.nHk)) < 1e-9, `fteAll≠正規+非正規+派遣`);
  assert.ok(Math.abs(parseFloat(t.d.getElementById("o-n").textContent) - N) < 0.05, `スライダーの職員数合計 o-n=${t.d.getElementById("o-n").textContent} ≠ ${f1(N)}`);
  assert.ok(Math.abs(parseFloat(t.d.getElementById("f-n").textContent) - N) < 0.05, `職種表 footer 合計 f-n ≠ ${f1(N)}`);
  const pointLabel = [...t.d.querySelectorAll("#chart text")].map(e => e.textContent).find(s => s.includes("万円") && s.includes("人") && s.includes("／"));
  assert.ok(pointLabel && pointLabel.includes(f1(N) + "人"), `グラフの点の人数が fteAll でない: ${pointLabel}`);
  assert.ok(Math.abs(c.proj.dilemma.keepRatio.nNow - N) < 1e-9, `両面カードの現在職員数 ≠ fteAll`);
  assert.ok(t.txt("#trend").includes(f1(N) + " 人"), `両面カードに現在職員数 ${f1(N)} 人 が出ていない`);
});

/* v0.5 A統一: 賃金下限の線は、額面入力を事業主負担込み（×(1+法定福利費率)）に換算した位置に引く。
   額面そのものの位置ではないこと、ラベルに両方併記されることを実DOMで確認する。 */
test("UI-18 賃金下限の線は 額面×(1+法定福利費率) の位置（ラベル併記）", () => {
  const t = open();
  t.set("atgt", 440);
  const c = stateOf(t);
  const svg = t.d.getElementById("chart");
  const pt = svg.querySelector('[data-o="point"]'), wline = svg.querySelector('[data-o="wage"]');
  assert.ok(pt && wline, `点または賃金下限の線がない`);
  const yBottom = 20 + (400 - 20 - 54);                       // VB.t + PH ＝ Y(0)
  const cy = parseFloat(pt.getAttribute("cy"));
  const valueAt = y => (yBottom - y) * c.A / (yBottom - cy);  // Y の逆写像（線形）
  const lineVal = valueAt(parseFloat(wline.getAttribute("y1")));
  const floorA = 440 * (1 + c.fuku / 100);
  assert.ok(Math.abs(lineVal - floorA) < 1.5, `賃金下限の線が floorA(${floorA.toFixed(1)}) の位置にない: ${lineVal.toFixed(1)}`);
  assert.ok(Math.abs(lineVal - 440) > 10, `賃金下限の線が額面440の位置にある（換算されていない）: ${lineVal.toFixed(1)}`);
  const wlabel = [...svg.querySelectorAll("text")].map(e => e.textContent).find(s => s.includes("賃金下限"));
  assert.ok(wlabel && wlabel.includes("440") && wlabel.includes("事業主負担込み") && wlabel.includes(f1floor(floorA)), `ラベルに額面と事業主負担込みの併記がない: ${wlabel}`);
  function f1floor(v){ return (Math.round(v * 10) / 10).toLocaleString("ja-JP", { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
});

/* ==== ゼロ除算・端点のガード（公開版で配置比率が 6.9e18 と表示された不具合の回帰） ====
   原因は2つ：(1) 比率基準の無いサービス（通所）で軸域を「現在の比率」から作っていたため、
   端まで動かすたびに軸が広がり発散した。(2) 核（介護・看護）が0に近づくと 利用者÷核 が
   極大化し、Infinity 経由で核が0に潰れて操作不能になった。
   探索1万件では端点（f=0/1）を踏まないため捕まらなかった。ここで明示的に端を踏む。 */
const SERVICES_ALL = ["tokuyou", "unit", "roken", "tsuusho"];
/* 画面テキスト（script要素を除く）に異常表記が出ていないか */
function screenAnomalies(d) {
  const out = [];
  d.querySelectorAll("body *").forEach(el => {
    if (el.tagName === "SCRIPT" || el.children.length) return;
    const s = (el.textContent || "").trim();
    if (/NaN|Infinity|[0-9]e\+[0-9]/.test(s) || /[0-9]{13,}/.test(s.replace(/[,\s]/g, ""))) out.push(s.slice(0, 60));
  });
  return out;
}

test("ZERO-01 バーの最小・最大・往復を全サービスで踏んでも発散しない", () => {
  for (const svc of SERVICES_ALL) {
    const t = open();
    t.svc(svc);
    const seen = [];
    /* 端点・極小値に加えて「左端を連続で踏む」列を入れる。実際のドラッグは1ジェスチャで
       多数の input を出すため、軸が現在値に追従する実装だと 1.4倍ずつ広がって発散する
       （公開版の 6.9e18 はこの経路）。往復だけでは再現しないので連続押しを必ず含める。 */
    const seq = [0, 1, 0, 1, 0.5, 0.002, 0.998];
    for (let i = 0; i < 40; i++) seq.push(0);      // 左端を連続40回（＝ドラッグ1回分の途中経過）
    for (let i = 0; i < 40; i++) seq.push(1);      // 右端も連続で
    for (const f of seq) {
      slide(t, f);
      const c = stateOf(t);
      if (c.ratioActual != null) seen.push(c.ratioActual);
      assert.ok(c.coreN > 0, `${svc} f=${f}: 介護・看護が0に潰れた（coreN=${c.coreN}）`);
      assert.ok(Number.isFinite(c.fteAll) && c.fteAll > 0, `${svc} f=${f}: 職員数が壊れた（${c.fteAll}）`);
      assert.ok(c.ratioActual == null || (Number.isFinite(c.ratioActual) && c.ratioActual < 1e3),
        `${svc} f=${f}: 配置比率が発散した（${c.ratioActual}）`);
    }
    // 端点を繰り返し踏んでも比率の最大値が増え続けない（軸が滑らない）
    const mx = Math.max(...seen);
    assert.ok(mx < 1e3, `${svc}: 比率が発散（最大 ${mx}）`);
    assert.equal(screenAnomalies(t.d).length, 0, `${svc}: 画面に異常表記 ${screenAnomalies(t.d).join(" | ")}`);
    assert.ok(t.d.querySelectorAll("#chart *").length > 10, `${svc}: 端点操作後にグラフが壊れた`);
  }
});

test("ZERO-02 介護・看護が0でも比率を数値で出さず、画面が壊れない（復帰もできる）", () => {
  const t = open();
  t.row(0, "n", 0); t.row(1, "n", 0);           // 介護・看護を0に手入力
  const c = stateOf(t);
  assert.equal(c.ratioActual, null, `核0で比率が数値になっている: ${c.ratioActual}`);
  assert.equal(t.d.getElementById("o-ratiobar").textContent, "–", `バーの比率が「–」でない`);
  assert.ok(!t.txt("#ratiobar").includes("0.00 : 1"), `指標バーに「0.00 : 1」が出ている`);
  assert.equal(screenAnomalies(t.d).length, 0, `画面に異常表記: ${screenAnomalies(t.d).join(" | ")}`);
  // 核0のままスライダーを動かしても潰れたまま壊れない
  slide(t, 1); slide(t, 0);
  assert.equal(screenAnomalies(t.d).length, 0, `核0でのスライダー操作後に異常表記`);
  // 「不足職種を基準まで埋める」で復帰できる（0からでも詰まない）
  t.click("fill-std");
  assert.ok(stateOf(t).coreN > 0, `核0から復帰できない（fill-std後も coreN=${stateOf(t).coreN}）`);
});

test("ZERO-03 利用者0（定員0・稼働率0）でも壊れず、描けない理由を出す", () => {
  for (const [tag, id] of [["稼働率0", "sz-occ"], ["定員0", "sz-cap"]]) {
    const t = open();
    t.set(id, 0);
    slide(t, 0); slide(t, 1);                      // 端点も踏む
    const c = stateOf(t);
    assert.equal(c.users, 0, `${tag}: 前提（利用者0）が成立していない`);
    assert.equal(c.ratioActual, null, `${tag}: 利用者0で比率が数値になっている`);
    assert.equal(screenAnomalies(t.d).length, 0, `${tag}: 画面に異常表記 ${screenAnomalies(t.d).join(" | ")}`);
    assert.ok(t.d.querySelector('#chart [data-o="nochart"]'), `${tag}: 曲線を描けない理由が出ていない`);
  }
});

test("ZERO-04 収益0・人件費0・派遣費が総額と同額でも異常表記を出さない", () => {
  for (const [tag, id, v] of [["収益0", "rev", 0], ["人件費0", "total", 0], ["派遣費=総額", "haken-fee", 99999]]) {
    const t = open();
    t.set(id, v);
    slide(t, 0); slide(t, 1);
    assert.equal(screenAnomalies(t.d).length, 0, `${tag}: 画面に異常表記 ${screenAnomalies(t.d).join(" | ")}`);
  }
});

/* ==== 案B（2026-07-28）: 横軸は職員数に統一し、配置比率は法令の比率基準があるサービスでのみ併記 ====
   通所介護の人員基準は「利用者15人まで1、超過5人ごとに+1を提供時間帯を通じて」で、対利用者の
   比率という形をしていない。比率目盛り・基準線・比率スライダー・基準割れ表示を出さないこと。 */
function chartFacts(t) {
  const d = t.d;
  return {
    ratioTicks: d.querySelectorAll('#chart [data-rt]').length,
    headTicks:  d.querySelectorAll('#chart [data-nt]').length,
    baseLines:  [...d.querySelectorAll("#chart line")].filter(e => e.getAttribute("stroke") === "#B23A2E").length,
    legendBaseHidden: d.getElementById("lg-base").hidden,
    note:  d.getElementById("chartnote").textContent,
    label: d.getElementById("scale-label").textContent.replace(/\s+/g, " ").trim()
  };
}

test("AXB-01 通所介護では比率目盛り・基準線・凡例の基準線・比率スライダーを出さない", () => {
  const t = open();
  t.svc("tsuusho");
  const f = chartFacts(t);
  assert.equal(f.ratioTicks, 0, `通所で上段の比率目盛りが出ている（${f.ratioTicks}件）`);
  assert.ok(f.headTicks >= 3, `通所で常勤換算数の目盛りが出ていない（${f.headTicks}件）`);
  assert.equal(f.baseLines, 0, `通所で基準線が描かれている（${f.baseLines}本）`);
  assert.equal(f.legendBaseHidden, true, `通所で凡例の「基準線」が残っている`);
  assert.ok(!f.label.includes("配置比率"), `通所のスライダーが比率ラベルのまま: ${f.label}`);
  assert.ok(f.label.includes("職員数"), `通所のスライダーが職員数主表示でない: ${f.label}`);
  assert.ok(!f.note.includes("基準割れ"), `通所の説明に「基準割れ」が残っている`);
  /* 指標バーの比率セルは「非表示リスト」に含まれていないため残す（法令基準との比較はせず
     『常勤換算ベース』と添えるだけの記述統計）。ただし基準の主張は一切しないことを固定する。 */
  const bar = t.txt("#ratiobar");
  assert.ok(!/基準\s*[\d.]+\s*:\s*1/.test(bar), `通所の指標バーが比率の基準を主張している: ${bar}`);
  assert.ok(!t.d.querySelector("#ratiobar .cell.warn"), `通所の指標バーが基準割れ警告を出している`);
});

test("AXB-02 通所の軸域はドラッグで動かない（基準の単純合計にアンカー）", () => {
  const t = open();
  t.svc("tsuusho");
  const std0 = stateOf(t).stdN;
  const readTicks = () => [...t.d.querySelectorAll('#chart [data-nt]')].map(e => e.textContent).join(",");
  const ticks0 = readTicks();
  // 端点・往復を含めて動かす
  for (const f of [0, 1, 0.5, 1, 0, 0.25, 1, 0]) slide(t, f);
  assert.equal(stateOf(t).stdN, std0, `ドラッグで基準の単純合計が変わった（アンカーが動く）`);
  assert.equal(readTicks(), ticks0, `ドラッグで横軸の目盛りが変わった（軸域が動いている）\n前:${ticks0}\n後:${readTicks()}`);
  // 同じつまみ位置に戻れば同じ職員数に戻る（軸が固定である帰結）
  slide(t, 0); const a = stateOf(t).n;
  slide(t, 1); slide(t, 0); const b = stateOf(t).n;
  assert.ok(Math.abs(a - b) < 1e-6, `同じつまみ位置で職員数が再現しない: ${a} vs ${b}`);
});

test("AXB-03 比率基準のあるサービスは従来表示を維持する", () => {
  for (const svc of ["tokuyou", "unit", "roken"]) {
    const t = open();
    t.svc(svc);
    const f = chartFacts(t);
    assert.ok(f.ratioTicks >= 3, `${svc}: 上段の比率目盛りが減った（${f.ratioTicks}件）`);
    assert.equal(f.baseLines, 1, `${svc}: 基準線が1本でない（${f.baseLines}本）`);
    assert.equal(f.legendBaseHidden, false, `${svc}: 凡例の「基準線」が消えた`);
    assert.ok(f.label.includes("配置比率"), `${svc}: スライダーの比率ラベルが消えた: ${f.label}`);
    assert.ok(f.note.includes("配置比率") && f.note.includes("基準割れ"), `${svc}: 説明から比率／基準割れが消えた`);
    assert.ok(t.txt("#ratiobar").includes(": 1"), `${svc}: 指標バーの比率セルが消えた`);
  }
});
