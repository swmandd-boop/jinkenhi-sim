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
  const dom = new JSDOM(readFileSync(resolve(root, "jinkenhi-sim.html"), "utf8"),
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

/* 実バグ①: 合計行の「正規計」が合計人数を表示していた */
test("UI-01 合計行の正規計＋非正規計が合計に一致する", () => {
  const t = open();
  t.row(4, "n", 20); t.row(4, "hi", 11); t.row(8, "n", 1); t.row(8, "hi", 2);
  assert.ok(Math.abs(t.num("f-nbase") + t.num("f-hi") - t.num("f-n")) < 0.05,
    `正規${t.num("f-nbase")} + 非正規${t.num("f-hi")} ≠ 合計${t.num("f-n")}`);
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

/* 自動計算のオンオフで収益欄の状態が正しく切り替わる */
test("UI-04 規模連動中は収益欄が読み取り専用になる", () => {
  const t = open();
  assert.equal(t.d.getElementById("rev").readOnly, true);
  const cb = t.d.getElementById("auto-rev"); cb.checked = false;
  cb.dispatchEvent(new (t.d.defaultView.Event)("input", { bubbles: true }));
  assert.equal(t.d.getElementById("rev").readOnly, false);
});

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
/* tbody 各行の 正規入力・非正規入力・合計セル を読む */
function rowTriples(t) {
  return [...t.d.querySelectorAll("#tbody tr")].map(tr => ({
    n:   parseFloat(tr.querySelector('[data-f="n"]').value)  || 0,
    hi:  parseFloat(tr.querySelector('[data-f="hi"]').value) || 0,
    tot: parseFloat((tr.querySelector('[data-c="tot"]').textContent || "").replace(/[^\d.-]/g, "")) || 0
  }));
}

test("UI-06 スライダー確定後は正規計＋非正規計＝合計（合計行・各行とも・全scale）", () => {
  for (const sc of [0.4, 0.7, 1.0, 1.3, 1.8]) {
    const t = open();
    // 正規・非正規を混在させる（介護を正規20/非正規11、事務・調理も入れる）
    t.row(4, "n", 20); t.row(4, "hi", 11); t.row(8, "n", 3); t.row(9, "n", 2);
    slide(t, sc);
    // 確定後は scale が 1 に戻る
    assert.equal(parseFloat(t.d.getElementById("scale").value), 1, `scale=${sc}: 確定後に1へ戻っていない`);
    // 合計行: 正規計＋非正規計＝合計
    assert.ok(Math.abs(t.num("f-nbase") + t.num("f-hi") - t.num("f-n")) < 0.05,
      `scale=${sc}: 正規計${t.num("f-nbase")}＋非正規計${t.num("f-hi")}≠合計${t.num("f-n")}`);
    // 各行: 正規＋非正規＝合計
    for (const r of rowTriples(t)) {
      assert.ok(Math.abs(r.n + r.hi - r.tot) < 0.05,
        `scale=${sc}: 行 正規${r.n}＋非正規${r.hi}≠合計${r.tot}`);
    }
  }
});

test("UI-07 スライダー確定で scale が1に戻り、確定前の合計人数が保存される", () => {
  const t = open();
  t.row(4, "n", 20); t.row(4, "hi", 11); t.row(8, "n", 3); t.row(9, "n", 2);
  const el = t.d.getElementById("scale");
  const Ev = t.d.defaultView.Event;
  el.value = "1.5";
  el.dispatchEvent(new Ev("input", { bubbles: true }));      // ドラッグ中：合計が1.5倍で表示
  const totalDuringDrag = t.num("o-n");                       // 確定前の表示（＝合計人数）
  el.dispatchEvent(new Ev("change", { bubbles: true }));      // 離して確定＝書き戻し
  assert.equal(parseFloat(t.d.getElementById("scale").value), 1, "確定後 scale が1でない");
  const triples = rowTriples(t);
  const sum = triples.reduce((a, r) => a + r.n + r.hi, 0);
  // 0.1人単位の丸めを許容（各職種で n・hi を独立に丸めるため、最大 0.1×行数 の差）
  assert.ok(Math.abs(sum - totalDuringDrag) <= 0.1 * triples.length,
    `確定後合計${sum.toFixed(1)} が確定前表示${totalDuringDrag} と乖離（許容 ${(0.1 * triples.length).toFixed(1)}）`);
  // footer 合計と入力合計も一致
  assert.ok(Math.abs(t.num("f-n") - sum) < 0.05, `footer合計${t.num("f-n")}≠入力合計${sum.toFixed(1)}`);
});

/* 新機能B（§6）: 定点の位置づけ。起動時（基準ちょうど配置）は警告を出し、
   下回れない平均年収が未入力なら賃金側の判定を伏せる。敵対的レビュー指摘②への対処。 */
test("UI-08 定点の位置づけ：起動時は基準ちょうど警告＋賃金余裕は未入力で伏せる", () => {
  const t = open();
  const anchor = () => t.txt("#anchor");
  assert.ok(anchor().includes("配置が基準ちょうど"), `起動時に基準ちょうど警告なし: ${anchor()}`);
  assert.ok(anchor().includes("賃金の余裕を見るには"), `atgt未入力で賃金余裕を伏せていない: ${anchor()}`);
  // 下回れない平均年収を入力し、全職種を増員して基準ちょうどから外す
  t.set("atgt", 450);
  slide(t, 1.6);
  assert.ok(!anchor().includes("配置が基準ちょうど"), `増員後も基準ちょうど警告が残る: ${anchor()}`);
  assert.ok(anchor().includes("賃金の余裕"), `atgt入力後に賃金余裕を出していない: ${anchor()}`);
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
