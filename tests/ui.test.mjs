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
  /* 「万円」「人」「／」の3語一致だと軸ラベル（1人あたり給与費（万円／年…））も拾ってしまう。
     現在地ラベルだけが持つ「<数字>人 ／ 」の並びで絞る（単位変更の前後どちらのDOMにも存在する形）。 */
  const pointLabel = [...t.d.querySelectorAll("#chart text")].map(e => e.textContent).find(s => /\d人 ／ /.test(s));
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
    baseLabel:  (d.querySelector('#chart [data-o="baselabel"]') || {}).textContent || "",
    baseMarkX:  (() => { const e = d.querySelector('#chart [data-o="basemark"]'); return e ? parseFloat(e.getAttribute("x1")) : null; })(),
    bandLeftX:  (() => {
      const p = [...d.querySelectorAll("#chart path")].find(e => e.getAttribute("stroke") === "#2A7F72");
      if (!p) return null;
      const xs = (p.getAttribute("d").match(/[ML]([\d.]+)/g) || []).map(t => parseFloat(t.slice(1)));
      return xs.length ? Math.min(...xs) : null;
    })(),
    legendBand: d.getElementById("lg-band").textContent.trim(),
    legendBase: d.getElementById("lg-base").textContent.trim(),
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
  /* 2026-07-28: 通所にも**人数ベースの基準マーカー**（基準の単純合計の位置）を引くようにしたため、
     「基準線が0本」ではなく「**比率**の基準線ではないこと」を固定する。 */
  assert.ok(!/[\d.]+\s*:\s*1/.test(f.baseLabel), `通所の基準ラベルが比率になっている: ${f.baseLabel}`);
  assert.equal(f.legendBaseHidden, false, `通所で凡例の基準線が消えている（人数マーカーを引くので出す）`);
  assert.ok(f.legendBase.includes("人数"), `通所の凡例が比率の基準線のままになっている: ${f.legendBase}`);
  assert.ok(!f.label.includes("配置比率"), `通所のスライダーが比率ラベルのまま: ${f.label}`);
  assert.ok(f.label.includes("職員数"), `通所のスライダーが職員数主表示でない: ${f.label}`);
  assert.ok(!f.note.includes("基準割れ"), `通所の説明に「基準割れ」が残っている`);
  /* 指標バーの比率セルも出さない（水田さん判断 2026-07-28）。グラフから比率を消したのと同じ理由：
     基準がないのに数字だけ出すと比較先が無いまま独り歩きし、かつ同じ位置の同じセルが他サービスでは
     基準との比較に使われるため「同じ名前で違うものを指す」状態になる。書き出しテキストも同様。 */
  const bar = t.txt("#ratiobar");
  assert.ok(!bar.includes(": 1"), `通所の指標バーに比率セルが出ている: ${bar}`);
  assert.ok(!bar.includes("対 利用者"), `通所の指標バーに比率のラベルが残っている: ${bar}`);
  assert.ok(!t.d.querySelector("#ratiobar .cell.warn"), `通所の指標バーが基準割れ警告を出している`);
  // 書き出しテキストにも比率を出さない
  t.click("mk");
  const out = t.d.getElementById("out").value;
  assert.ok(!out.includes("対 利用者"), `通所の書き出しに配置比率が出ている`);
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

/* ==== 公開版の文言（release-gate 第2回の指摘への対応・2026-07-28）====
   ・記号「（A）」：A一本化で B を廃したため、対になる記号がなく定義もどこにもない → 画面から外す
   ・免責一文：「個人情報を入力しないでください」（前回の公開明示文案から脱落していた）
   ・問い合わせ導線：相談内容が伝わる文言に（リンク先は変更しない） */
test("PUB-01 画面に記号「（A）」を出さない（A・B 2本立ての名残を残さない）", () => {
  const t = open();
  const body = t.d.body.textContent;
  assert.ok(!body.includes("（A）"), `画面に「（A）」が残っている`);
  assert.ok(!body.includes("（B）"), `画面に「（B）」が残っている`);
  // 指標そのものの説明は残っていること（記号だけを外す）
  assert.ok(body.includes("1人あたり給与費"), `1人あたり給与費の表記自体が消えている`);
  assert.ok(t.txt(".caveat").includes("人件費総額 ÷ 職員数（正規＋非正規＋派遣）"), `定義の説明が消えている`);
});

test("PUB-02 免責一文に個人情報を入力しない旨がある", () => {
  const t = open();
  const dis = t.txt("footer.site-footer .disclaim");
  assert.ok(dis.includes("個人情報は入力しないでください"), `免責に個人情報の注意がない: ${dis.slice(-120)}`);
  assert.ok(dis.includes("送信されません"), `外部送信しない旨の補足がない`);
  // 免責の他の趣旨も維持されていること（書き換えで落とさない）
  assert.ok(dis.includes("指定権者の解釈を代替するものではありません"), `指定権者の趣旨が落ちている`);
  assert.ok(dis.includes("判断そのものを行うものではありません"), `判断の材料である趣旨が落ちている`);
  assert.ok(dis.includes("未検証のサンプル値"), `未検証サンプルの趣旨が落ちている`);
});

test("PUB-03 問い合わせ導線は相談内容が伝わる文言で、リンク先は変わらない", () => {
  const t = open();
  const a = t.d.querySelector("footer.site-footer .contact a");
  assert.ok(a, `問い合わせリンクがない`);
  assert.equal(a.getAttribute("href"), "https://forms.gle/nZd22V4geA5LAGVB8", `リンク先が変わっている`);
  assert.equal(a.textContent.trim(), "この結果の読み解き、改善の方向性についてご相談いただけます");
  assert.equal(a.getAttribute("rel"), "noopener", `rel=noopener が外れている`);
});

/* AXB-04（2026-07-28）: 通所の軸域を特養系と同じ幅に広げた。
   特養系の軸は 左端 R=基準+1／右端 R=1 で、核（介護・看護）は core(R)=利用者÷R だから
   「核を 基準/(基準+1)=0.75倍 〜 基準/1=3倍」にした範囲にあたる。通所も同じ核倍率にした。
   ★stdN に直接倍率を掛けないのは、その他職員まで増減させることになり、核しか動かさない
     ドラッグと対応しなくなるため。★左端でも核は基準の0.75倍（>0）でゼロ除算が起きない。 */
test("AXB-04 通所の軸は基準を割る領域まで見え、左端でも核が0にならない", () => {
  const t = open();
  t.svc("tsuusho");
  const c0 = stateOf(t);
  const coreStd = c0.coreStd, otherStd = c0.stdN - c0.coreStd;
  assert.ok(coreStd > 0, `前提: 核の基準がある`);

  // 左端：基準の単純合計を下回る（＝基準割れの領域が見えている）
  slide(t, 0);
  const lo = stateOf(t);
  assert.ok(lo.n < c0.stdN, `左端 ${lo.n} が基準の単純合計 ${c0.stdN} を下回っていない（基準割れが見えない）`);
  assert.ok(Math.abs(lo.n - (coreStd * 0.75 + otherStd)) < 1e-6,
    `左端が「核0.75倍＋その他」になっていない: ${lo.n} 期待 ${coreStd * 0.75 + otherStd}`);
  // 左端の核は基準の75%（特養の 4:1 と同じ薄さ）で、0ではない
  assert.ok(Math.abs(lo.coreN / coreStd - 0.75) < 1e-6, `左端の核が基準の0.75倍でない: ${lo.coreN / coreStd}`);
  assert.ok(lo.coreN > 0, `左端で核が0になっている（ゼロ除算の再発）`);

  // 右端：核が基準の3倍
  slide(t, 1);
  const hi = stateOf(t);
  assert.ok(Math.abs(hi.coreN / coreStd - 3) < 1e-6, `右端の核が基準の3倍でない: ${hi.coreN / coreStd}`);
  assert.ok(hi.n > c0.stdN, `右端 ${hi.n} が基準を上回っていない`);

  // 端点を連続で踏んでも壊れない（ゼロ除算・発散・NaN）
  const seq = [];
  for (let i = 0; i < 40; i++) seq.push(0);
  for (let i = 0; i < 40; i++) seq.push(1);
  seq.push(0);
  for (const f of seq) {
    slide(t, f);
    const c = stateOf(t);
    assert.ok(c.coreN > 0, `連続操作で核が0に潰れた（f=${f}）`);
    assert.ok(Number.isFinite(c.n) && Number.isFinite(c.A), `連続操作で職員数/Aが壊れた（f=${f}）`);
    assert.ok(c.ratioActual == null || Number.isFinite(c.ratioActual), `連続操作で比率が発散した（f=${f}）`);
  }
  assert.equal(screenAnomalies(t.d).length, 0, `画面に異常表記: ${screenAnomalies(t.d).join(" | ")}`);

  // 特養系の軸は「核0.75倍〜3倍」と一致している（同じ幅であることの確認）
  const u = open();
  u.svc("tokuyou");
  const cu = stateOf(u);
  slide(u, 0); const ulo = stateOf(u);
  slide(u, 1); const uhi = stateOf(u);
  assert.ok(Math.abs(ulo.coreN / cu.coreStd - 0.75) < 1e-6, `特養の左端の核倍率が0.75でない: ${ulo.coreN / cu.coreStd}`);
  assert.ok(Math.abs(uhi.coreN / cu.coreStd - 3) < 1e-6, `特養の右端の核倍率が3でない: ${uhi.coreN / cu.coreStd}`);
});

/* AXB-05（2026-07-28）: 比率基準の無いサービス（通所）に、人数ベースの基準マーカーを引く。
   軸を基準より左へ広げた（核0.75倍）ため、境界が見えないと広げた意味が半減する。
   位置は「基準の単純合計（各職種の基準の合計）」＝法令由来の値で、閾値の発明ではない。
   特養系は既存の比率基準線があるため人数マーカーは追加しない（重複を避ける）。 */
test("AXB-05 通所に人数ベースの基準マーカーが基準の単純合計の位置に出る", () => {
  const VBl = 64, PW = 640 - 64 - 22;
  const t = open();
  t.svc("tsuusho");
  const c = stateOf(t);
  const f = chartFacts(t);
  // ラベルは「基準 8.1人」形式（比率ではない）
  assert.ok(f.baseLabel.includes("基準") && f.baseLabel.includes("人"), `基準マーカーのラベルがない: ${f.baseLabel}`);
  assert.ok(f.baseLabel.includes((Math.round(c.stdN * 10) / 10).toFixed(1)),
    `ラベルが基準の単純合計 ${c.stdN} を示していない: ${f.baseLabel}`);
  // 位置が基準の単純合計に対応する（軸域から逆算した割合と一致）
  const E = t.d.defaultView.ENGINE;
  const coreStd = c.coreStd, otherStd = c.stdN - c.coreStd;
  const nmin = coreStd * 0.75 + otherStd, nmax = coreStd * 3 + otherStd;
  const expectX = VBl + (c.stdN - nmin) / (nmax - nmin) * PW;
  assert.ok(f.baseMarkX != null, `基準マーカーの線が描かれていない`);
  assert.ok(Math.abs(f.baseMarkX - expectX) < 0.6,
    `基準マーカーの位置がずれている: ${f.baseMarkX} 期待 ${expectX}`);
  // 基準より左（薄い側）にいる＝マーカーは現在地より右か左かが分かる位置にある
  assert.ok(f.baseMarkX > VBl && f.baseMarkX < VBl + PW, `基準マーカーが軸の外にある: ${f.baseMarkX}`);

  // 軸域が変わっても（定員・稼働率を変える）マーカーは基準の単純合計に追従する
  t.set("sz-cap", 60);
  const c2 = stateOf(t), f2 = chartFacts(t);
  assert.ok(c2.stdN !== c.stdN, `前提: 定員変更で基準の単純合計が変わる`);
  const core2 = c2.coreStd, other2 = c2.stdN - c2.coreStd;
  const expectX2 = VBl + (c2.stdN - (core2 * 0.75 + other2)) / ((core2 * 3 + other2) - (core2 * 0.75 + other2)) * PW;
  assert.ok(Math.abs(f2.baseMarkX - expectX2) < 0.6, `軸域変更後にマーカーが追従していない: ${f2.baseMarkX} 期待 ${expectX2}`);
  assert.ok(f2.baseLabel.includes((Math.round(c2.stdN * 10) / 10).toFixed(1)), `ラベルが更新されていない: ${f2.baseLabel}`);

  // ドラッグしてもマーカーは動かない（基準は実配置に依存しない）
  const before = chartFacts(t).baseMarkX;
  slide(t, 0); slide(t, 1); slide(t, 0.5);
  assert.ok(Math.abs(chartFacts(t).baseMarkX - before) < 1e-6, `ドラッグで基準マーカーが動いた`);
});

test("AXB-06 特養系には人数マーカーを足さず、比率の基準線のままにする", () => {
  for (const svc of ["tokuyou", "unit", "roken"]) {
    const t = open();
    t.svc(svc);
    const f = chartFacts(t);
    assert.ok(/[\d.]+\s*:\s*1/.test(f.baseLabel), `${svc}: 基準ラベルが比率でない: ${f.baseLabel}`);
    assert.ok(!f.baseLabel.includes("人"), `${svc}: 人数マーカーが混ざっている: ${f.baseLabel}`);
    assert.equal(f.baseLines, 1, `${svc}: 基準の縦線が1本でない（${f.baseLines}本）＝重複して引かれている`);
  }
});

/* AXB-07（2026-07-28・release-gate 第3回 H1 への対応）:
   緑の太実線は「ここなら成立する」区間なので、**基準を割った領域を含めてはいけない**。
   以前は比率基準の無いサービス（通所）で基準による切り出しをしておらず、賃金下限だけで帯を
   引いていたため、基準割れの位置まで帯が伸び、充足判定パネルの「下回っています」と
   同じ画面で逆の合図を出していた。基準の物差しはサービスで違うが（比率／人数）意味は同じ。 */
test("AXB-07 緑の帯は基準を割った領域を含まない（全サービス）", () => {
  for (const svc of ["tsuusho", "tokuyou", "unit", "roken"]) {
    const t = open();
    t.svc(svc);
    t.set("atgt", 300);                    // 賃金下限を下げ、帯が賃金側で切れないようにする
    const f = chartFacts(t);
    assert.ok(f.baseMarkX != null, `${svc}: 基準の縦線がない`);
    assert.ok(f.bandLeftX != null, `${svc}: 緑の帯が描かれていない`);
    assert.ok(f.bandLeftX >= f.baseMarkX - 1,
      `${svc}: 緑の帯が基準より左（基準割れ側）まで伸びている（帯左端 ${f.bandLeftX} < 基準 ${f.baseMarkX}）`);
  }
});

test("AXB-08 基準割れの位置では、グラフと充足判定が同じことを言う", () => {
  const t = open();
  t.svc("tsuusho");
  t.set("atgt", 300);
  slide(t, 0);                             // 左端＝基準を割る位置
  assert.ok(t.txt("#compliance h3").includes("下回っています"), `前提: 基準割れになっていない`);
  const f = chartFacts(t);
  const pt = t.d.querySelector('#chart [data-o="point"]');
  const px = parseFloat(pt.getAttribute("cx"));
  // 点が帯の外にある＝グラフも「成立しない」と言っている（画面内で逆の合図を出さない）
  assert.ok(f.bandLeftX == null || px < f.bandLeftX - 0.5,
    `基準割れなのに点が緑の帯の内側にある（点 ${px} / 帯左端 ${f.bandLeftX}）`);
});

test("AXB-09 凡例は、同じ意味の要素を同じ語で呼び、違う意味の要素を区別する", () => {
  const facts = {};
  for (const svc of ["tsuusho", "tokuyou", "unit", "roken"]) {
    const t = open();
    t.svc(svc);
    facts[svc] = chartFacts(t);
  }
  // 帯：どのサービスでも同じ意味 → 同じ語
  const bands = Object.values(facts).map(f => f.legendBand);
  assert.equal(new Set(bands).size, 1, `帯の凡例がサービスで違う: ${JSON.stringify(bands)}`);
  /* 帯は「合計人数と賃金の目安」であって職種別の充足判定ではない（I1撤回で名乗りを実態に合わせた）。 */
  assert.ok(bands[0].includes("合計人数") && bands[0].includes("判定欄"),
    `帯の凡例が「合計の目安」であることと判定欄への誘導を表していない: ${bands[0]}`);
  // 基準線：意味が違う（配置比率の基準／人数の基準）→ 語を区別する
  assert.ok(facts.tsuusho.legendBase.includes("人数"), `通所の基準線の凡例が人数と分かる語でない: ${facts.tsuusho.legendBase}`);
  for (const svc of ["tokuyou", "unit", "roken"]) {
    assert.ok(facts[svc].legendBase.includes("配置比率"), `${svc}の基準線の凡例が配置比率と分かる語でない: ${facts[svc].legendBase}`);
  }
  assert.notEqual(facts.tsuusho.legendBase, facts.tokuyou.legendBase, `違う意味の基準線が同じ語で呼ばれている`);
});

/* AXB-10（2026-07-28・release-gate 第4回 I1 への対応）:
   緑の帯の基準判定を nMinComp（いまの職種構成のまま人数を増減させたとき全職種が基準を満たす
   最小の合計）にした。合計の単純合計 stdN で切ると、caveat の「事務や調理を厚くすれば合計を
   満たしたまま介護・看護が基準を割る／合計の下限だけでは判定できません」と矛盾する。
   ★現在地では 充足 ⟺ n >= nMinComp（sMin<=1 ⟺ nMinComp<=fteAll）が厳密に成り立つので、
     点が帯の内側かどうかと充足判定パネルの結論は必ず一致する。偏った構成でも成り立つことを固定。
   ★境界（基準ちょうど＝起動時の初期状態）で点が帯から外れて見えないよう、seg() は条件が
     切り替わる n を明示的にサンプルへ入れている。初期状態も本テストで踏む。 */
function bandRange(t) {
  const p = [...t.d.querySelectorAll("#chart path")].find(e => e.getAttribute("stroke") === "#2A7F72");
  if (!p) return null;
  const xs = (p.getAttribute("d").match(/[ML]([\d.]+)/g) || []).map(v => parseFloat(v.slice(1)));
  return xs.length ? { min: Math.min(...xs), max: Math.max(...xs) } : null;
}
test("AXB-10 点が帯の内側かどうかは「合計人数と賃金」の条件と一致し、職種別の差は名指しされる", () => {
  /* ★I1撤回（2026-07-28）にともなう契約の変更。
     帯は nMinComp（構成依存）ではなく nbase（基準の単純合計・固定）で切るため、
     「点が帯の内側 ⟺ 充足判定パネルの結論」は**もはや成り立たない**（合計は足りているが
     職種別は未達、という構成が帯の内側に入る）。テストは削除せず、次の2つを固定する：
       (a) 帯の内側かどうかが、帯が名乗っている条件（合計人数・賃金・比率）と厳密に一致すること
       (b) 帯の内側なのに職種別が未達のときは、グラフ上で名指しすること
           ＝画面が逆の合図を出したまま黙っていないこと（H1/I1 の再発防止はこちらが担う） */
  const cases = [
    ["tsuusho", "介護2.0/その他6.0（合計は基準以上・職種別は未達）", t => { t.row(0, "n", 2.0); t.row(2, "n", 6.0); }],
    ["tsuusho", "基準どおり（起動時＝境界）", () => {}],
    ["tsuusho", "全体的に厚い", t => { t.row(0, "n", 9); t.row(1, "n", 3); t.row(2, "n", 5); }],
    ["tokuyou", "その他だけ薄い", t => { t.row(2, "n", 1.0); }],
    ["tokuyou", "介護だけ薄い", t => { t.row(0, "n", 10); }],
    ["tokuyou", "基準どおり（起動時＝境界）", () => {}],
    ["roken",   "看護0（基準のある職種が0人）", t => { t.row(1, "n", 0); }],
    ["roken",   "基準どおり（起動時＝境界）", () => {}],
    ["unit",    "基準どおり（起動時＝境界）", () => {}],
    ["unit",    "全体的に厚い", t => { t.row(0, "n", 40); t.row(1, "n", 6); t.row(2, "n", 8); }]
  ];
  for (const [svc, label, mut] of cases) {
    const t = open();
    t.svc(svc);
    t.set("atgt", 300);
    mut(t);
    const c = stateOf(t);
    const b = bandRange(t), pt = t.d.querySelector('#chart [data-o="point"]');
    const px = pt ? parseFloat(pt.getAttribute("cx")) : null;
    const inBand = b != null && px != null && px >= b.min - 0.6 && px <= b.max + 0.6;

    // (a) 帯が名乗っている条件と一致する
    const std = c.svc.ratio && c.svc.ratio.std;
    const ratioOk = !std || (c.ratioActual != null && c.ratioActual <= std + 1e-9);
    /* 帯の左端 nbase は、比率基準ありなら「基準比率に対応する職員数」＝利用者÷基準＋その他、
       比率基準なしなら「基準の単純合計 stdN」。前者では n>=nbase は R<=基準 と同値になる。 */
    const otherFte = c.fteAll - c.coreN;
    const nbase = std ? (c.users / std + otherFte) : c.stdN;
    const totalOk = c.n >= nbase - 1e-9;
    const wageOk  = c.avg >= c.floorA - 1e-9;
    assert.equal(inBand, ratioOk && totalOk && wageOk,
      `[${svc}] ${label}: 帯の条件（比率${ratioOk}・合計${totalOk}・賃金${wageOk}）と 点が帯の内側=${inBand} が不一致`);

    // (b) 帯の内側なのに職種別が未達なら、グラフ上で名指しする
    const shortfall = !t.txt("#compliance h3").includes("満たしています");
    const warn = t.d.querySelector('#chart [data-o="gapwarn"]');
    if (inBand && shortfall) {
      assert.ok(warn, `[${svc}] ${label}: 帯の内側なのに職種別が未達なのに、グラフが黙っている`);
      assert.ok(warn.textContent.includes("判定欄"), `[${svc}] ${label}: 名指しに判定欄への誘導がない`);
    } else {
      assert.ok(!warn, `[${svc}] ${label}: 不要な名指しが出ている（帯内=${inBand} 未達=${shortfall}）`);
    }
  }
});

test("AXB-12 帯の左端はドラッグで動かない（帯は固定・その中を点が動く）", () => {
  /* I1撤回の理由そのもの：nMinComp で切ると構成が変わるたびに帯が伸び縮みして道具として使いにくい。
     nbase（基準の単純合計）は定員・稼働率だけで決まるので、ドラッグでは動かない。 */
  for (const svc of ["tsuusho", "tokuyou", "unit", "roken"]) {
    const t = open();
    t.svc(svc);
    t.set("atgt", 300);
    const first = bandRange(t);
    assert.ok(first, `${svc}: 帯が描かれていない`);
    for (const f of [0, 0.3, 0.6, 1, 0.5, 0, 1]) {
      slide(t, f);
      const b = bandRange(t);
      assert.ok(b, `${svc}: ドラッグ中に帯が消えた（f=${f}）`);
      assert.ok(Math.abs(b.min - first.min) < 0.6,
        `${svc}: 帯の左端がドラッグで動いた（f=${f}: ${b.min} ≠ ${first.min}）`);
    }
  }
});

test("AXB-11 凡例に破線と塗りの読み方がある（見えるが成立範囲でない領域の説明）", () => {
  for (const svc of ["tsuusho", "tokuyou"]) {
    const t = open();
    t.svc(svc);
    const items = [...t.d.querySelectorAll(".legend span")].map(e => e.textContent.trim());
    assert.ok(items.some(x => x.includes("同じ人件費で取り得る組み合わせ")),
      `${svc}: 破線の説明が凡例にない: ${JSON.stringify(items)}`);
    assert.ok(items.some(x => x.includes("基準を下回る領域")),
      `${svc}: 塗りの説明が凡例にない: ${JSON.stringify(items)}`);
    // 塗りの見本は線ではなく面（専用クラス）
    assert.ok(t.d.querySelector("#lg-fill i.sw"), `${svc}: 塗りの凡例の見本が面になっていない`);
  }
});

/* ★2026-07-28 実バグ：帯を描く if と「区間なし」の else の間に別の if を割り込ませたため、
   else の結合先がずれ、帯が描かれていても朱色の文言が同時に出ていた（全4サービスで再現）。
   帯の有無という1つの値からしか出さないことを固定する。 */
/* 属性ではなく文言で拾う。属性で拾うと「旧実装に属性が無いだけ」でテストが通ってしまい、
   fail-before が実証できない（この書き分けで実際に取り違えかけた）。 */
const noBandMsg = t => [...t.d.querySelectorAll("#chart text")]
  .find(e => /区間(なし|がありません)/.test(e.textContent)) || null;

test("AXB-13 帯が描かれているとき、グラフ内の「区間がありません」は出ない", () => {
  for (const svc of ["tsuusho", "tokuyou", "unit", "roken"]) {
    for (const atgt of [250, 300, 400]) {
      const t = open();
      t.svc(svc);
      t.set("atgt", atgt);
      for (const f of [0, 0.25, 0.5, 0.75, 1]) {
        slide(t, f);
        const b = bandRange(t), m = noBandMsg(t);
        assert.ok(b, `${svc} 賃金下限${atgt} f=${f}: 帯が引けるはずの条件で帯が無い`);
        assert.ok(!m, `${svc} 賃金下限${atgt} f=${f}: 帯があるのに「${m && m.textContent}」が同時に出ている`);
      }
    }
  }
});

test("AXB-14 帯が消えるとき（賃金下限が高すぎる）はグラフ内に理由が出る", () => {
  for (const svc of ["tsuusho", "tokuyou", "unit", "roken"]) {
    const t = open();
    t.svc(svc);
    t.set("atgt", 3000);                 // 基準どおりの人数をこの賃金では雇えない
    const c = stateOf(t);
    assert.ok(c.avg < c.floorA, `${svc}: 前提が崩れている（賃金下限を超えてしまっている）`);
    assert.equal(bandRange(t), null, `${svc}: 帯が消えるはずの条件で帯が残っている`);
    const m = noBandMsg(t);
    assert.ok(m, `${svc}: 帯が無いのにグラフが理由を出していない`);
    assert.ok(m.textContent.includes("賃金下限"), `${svc}: 文言に理由（賃金下限）が入っていない: ${m.textContent}`);
  }
});

test("AXB-15 帯の有無と朱色メッセージの有無は常に排他（4サービス×つまみ位置×賃金下限）", () => {
  let both = 0, neither = 0, n = 0;
  for (const svc of ["tsuusho", "tokuyou", "unit", "roken"]) {
    for (const atgt of [200, 350, 450, 600, 3000]) {
      const t = open();
      t.svc(svc);
      t.set("atgt", atgt);
      for (const f of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
        slide(t, f);
        const b = !!bandRange(t), m = !!noBandMsg(t);
        n++;
        if (b && m) both++;
        if (!b && !m) neither++;
      }
    }
  }
  assert.equal(n, 120, `検証したケース数が想定と違う: ${n}`);
  assert.equal(both, 0, `帯と「区間がありません」が同時に出たケース: ${both}/${n}`);
  assert.equal(neither, 0, `帯も理由も出ないケース（画面が黙る）: ${neither}/${n}`);
});

/* ★2026-07-29 金額表示の期間単位。engine の返り値から機械的に主張を導き、
   画面に出た文字列が「万円／年」で終わることを検査する（末尾一致）。
   セレクタは既存の要素・既存の文言だけを使う（新設の目印に依存しない・教訓 E-018）。 */
function moneyClaims(t){
  const c = stateOf(t), man = v => Math.round(v).toLocaleString("ja-JP");
  return [
    { where: "#o-wagepool", label: "職員給与原資",        want: man(c.pool) + " 万円／年" },
    { where: "#o-hakenfee", label: "派遣費用",            want: (c.hakenFee > 0 ? man(c.hakenFee) : "0") + " 万円／年" },
    { where: "#marginal",   label: "必要な追加人件費",     want: man(c.marg.needMoreTotal) + " 万円／年" },
    { where: "#marginal",   label: "収益増でまかなうなら", want: man(c.marg.revUp) + " 万円／年" }
  ];
}

test("CLAIM-01 engine の金額は画面上で「万円／年」を伴って出る（4サービス）", () => {
  for (const svc of ["tsuusho", "tokuyou", "unit", "roken"]) {
    const t = open();
    t.svc(svc);
    for (const { where, label, want } of moneyClaims(t)) {
      const got = t.txt(where);
      assert.ok(got.includes(want), `${svc} ${label}: 「${want}」が画面に無い（実際: ${got.slice(0, 120)}）`);
    }
  }
});

test("CLAIM-02 金額を出す表示に「万円」だけで終わる箇所が無い（人数・率・ポイントは対象外）", () => {
  for (const svc of ["tsuusho", "tokuyou", "unit", "roken"]) {
    const t = open();
    t.svc(svc);
    t.set("atgt", 450);            // 賃金側の判定文を出す
    t.set("g", 2.0);               // 推移・両面カードを出す
    for (const sel of ["#verdict", "#need-ratio", "#anchor", "#marginal", "#trend", "#ratiobar"]) {
      const s = t.txt(sel);
      const bad = s.match(/万円(?!／年)/g);
      assert.equal(bad, null, `${svc} ${sel}: 「万円」で終わる金額が ${bad && bad.length} 件ある → ${s.slice(0, 200)}`);
    }
  }
});

test("CLAIM-03 「いま動かすと何が起きるか」は1人あたりと法人全体を書き分ける", () => {
  const t = open();
  const s = t.txt("#marginal");
  assert.ok(s.includes("1人あたり給与費 −"), `1人あたりの行が無い: ${s.slice(0, 150)}`);
  assert.ok(/必要な追加人件費（法人全体）/.test(s), `追加人件費の分母（法人全体）が無い: ${s.slice(0, 200)}`);
  assert.ok(/収益増でまかなうなら（法人全体）/.test(s), `収益増の分母（法人全体）が無い: ${s.slice(0, 200)}`);
});

/* ① 利用者が上書きする入力欄の初期値は「検証」の対象ではなく入力例。
   一方、②の既定値（法定福利費率）に対する未検証の明示は残っていること。 */
test("PUB-04 入力欄の初期値は「入力例」と呼び、「未検証」を名乗らない", () => {
  const t = open();
  const badges = [...t.d.querySelectorAll(".samp")].map(e => e.textContent);
  const near = badges.filter(x => x.includes("初期値"));
  assert.ok(near.length >= 2, `入力欄の初期値バッジが見つからない: ${JSON.stringify(badges)}`);
  for (const b of near) assert.ok(!b.includes("未検証"), `入力欄の初期値バッジが「未検証」を名乗っている: ${b}`);
  for (const sel of ["#need-ratio", "#anchor"]) {
    const s = t.txt(sel);
    assert.ok(!s.includes("未検証"), `${sel} の未入力時の促し文に「未検証」が残っている: ${s}`);
  }
  const dis = t.txt(".disclaim");
  assert.ok(dis.includes("入力例"), `免責一文で入力欄の初期値が入力例と説明されていない`);
  assert.ok(dis.includes("未検証のサンプル値"), `既定値（法定福利費率など）の未検証の明示が消えている`);
});
