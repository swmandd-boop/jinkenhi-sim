/* 実ピクセルのレイアウト機械チェック（方針A）。
   jsdom は実レイアウトを持たないため、ヘッドレス Chrome（puppeteer-core＋システムChrome）で
   本体HTMLを複数のウィンドウ幅で描画し、職種名・数値が欠けないこと、親幅に追従して右に
   大きな余白が出ないこと、狭幅では切らずに横スクロールすることを実測で確認する。

   Chrome は CHROME_PATH / PUPPETEER_EXECUTABLE_PATH で上書き可。見つからなければ失敗する
   （実機目視に戻さない＝この機械チェックを必須ゲートとする方針のため、スキップしない）。 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/* 既定は本体HTML。LAYOUT_HTML で別ファイルを指すと、修正前コミットのHTMLに対して
   このテストが落ちることを（非破壊で）確認できる。 */
const htmlPath = process.env.LAYOUT_HTML ? resolve(process.env.LAYOUT_HTML) : resolve(root, "index.html");
const fileUrl = "file://" + htmlPath;

function findChrome() {
  const cands = [
    process.env.CHROME_PATH, process.env.PUPPETEER_EXECUTABLE_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/usr/bin/chromium"
  ].filter(Boolean);
  for (const p of cands) if (existsSync(p)) return p;
  throw new Error("Chrome/Chromium が見つかりません。CHROME_PATH を設定してください。候補: " + cands.join(", "));
}

let browser, page;
before(async () => {
  browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, args: ["--no-sandbox"] });
  page = await browser.newPage();
});
after(async () => { if (browser) await browser.close(); });

/* 指定幅で本体を読み込み、スライダーを右へ動かして多桁の値を作ってから、テーブルの実ピクセルを測る。 */
async function measure(width) {
  await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
  await page.goto(fileUrl, { waitUntil: "load" });
  return await page.evaluate(() => {
    const fire = (el, t) => el.dispatchEvent(new Event(t, { bubbles: true }));
    const sl = document.getElementById("scale"); sl.value = "1"; fire(sl, "input"); // 配置比率を最も手厚い側(1:1)へ＝介護・看護が最大人数（桁数が最大＝欠けの当たりが最も出やすい）
    const g = document.getElementById("g"); g.value = "2"; fire(g, "input");          // 推移表を出す
    const sc = document.querySelector(".tbl-scroll"), tbl = document.getElementById("tbl");
    const names = [...document.querySelectorAll("#tbody tr td:first-child")].map(td => {
      const n = td.querySelector(".rolename");
      return { name: n.textContent, over: n.scrollWidth - td.clientWidth };
    });
    const inputs = [...document.querySelectorAll('#tbody tr [data-f="n"],#tbody tr [data-f="hi"],#tbody tr [data-f="haken"]')]
      .map(i => ({ v: i.value, over: i.scrollWidth - i.clientWidth }));
    // 推移表：10年後の値セルの右端が、パネル内側の右端からどれだけ内側にあるか（右余白）
    const trend = document.getElementById("trend"), tPanel = trend.closest(".panel");
    const tRows = [...trend.querySelectorAll("table tr")];
    const yrCellRight = tRows.map(tr => tr.children[3]).filter(Boolean).map(td => td.getBoundingClientRect().right);
    const tPad = parseFloat(getComputedStyle(tPanel).paddingRight);
    const panelContentRight = tPanel.getBoundingClientRect().right - tPad;
    const trendYearRightMargin = yrCellRight.length ? panelContentRight - Math.max(...yrCellRight) : 999;
    // 横軸の2段目盛り（上段=配置比率 data-rt / 下段=常勤換算数 data-nt）が行内で重ならないこと
    const rowOverlap = (sel) => {
      const rects = [...document.querySelectorAll(sel)].map(e => e.getBoundingClientRect()).sort((a, b) => a.left - b.left);
      let ov = 0;
      for (let i = 1; i < rects.length; i++) ov = Math.max(ov, rects[i - 1].right - rects[i].left);
      return { n: rects.length, ov };
    };
    // 「同じジレンマの両面」2枚カード（g>0で表示）：文字が欠けず、狭幅では縦積みになること
    const dcards = [...document.querySelectorAll("#trend .dcard")].map(e => {
      const r = e.getBoundingClientRect();
      return { top: Math.round(r.top), over: e.scrollWidth - e.clientWidth };
    });
    /* 移動したブロック（2026-07-28）:
       - 免責・問い合わせ・版数（footer.site-footer）は左カラムの最後（STEP3の下）
       - 「前提と出典の扱い」（.caveat）は左右カラムをまたぐ全幅ブロック
       いずれも文字が欠けず、はみ出さないこと。全幅かどうかは .cols の幅と比べて判定する。 */
    const box = (sel) => {
      const e = document.querySelector(sel);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { left: Math.round(r.left), width: Math.round(r.width), top: Math.round(r.top),
               over: e.scrollWidth - e.clientWidth };
    };
    /* 金額の単位を「万円」→「万円／年」に伸ばしたぶん（2026-07-29）、数値が折り返す・欠ける
       箇所が出ていないかを実ピクセルで見る。対象は金額が出る要素と、その入れ物。 */
    const overs = (sel) => [...document.querySelectorAll(sel)]
      .map(e => ({ t: e.textContent.trim().slice(0, 40), over: e.scrollWidth - e.clientWidth }));
    const moneyOver = [].concat(
      overs(".readout .row .v"),          // 職員給与原資・派遣費用など
      overs("#marginal .row .k"),         // 「…必要な追加人件費（法人全体）」＝伸びた見出し
      overs("#marginal .row .v"),         // 「307 万円／年」
      overs("#ratiobar .cell .s"),             // 指標バーの補足「万円／年　人件費総額÷…」
      overs(".field .inline")             // 入力欄＋単位（万円／年）の行
    );
    /* SVG 内の文字（軸ラベル・賃金下限ラベル・現在地）が viewBox からはみ出していないか。
       はみ出すと端が切れて読めなくなる。viewBox は 0 0 640 400。 */
    const svgOver = [...document.querySelectorAll("#chart text")].map(e => {
      let b; try { b = e.getBBox(); } catch { return { t: "", over: 0 }; }
      return { t: e.textContent.slice(0, 30), over: Math.max(0, Math.round(b.x + b.width - 640), Math.round(-b.x)) };
    });
    const cols = document.querySelector(".cols").getBoundingClientRect();
    const leftCol = document.querySelector(".cols > div:first-child").getBoundingClientRect();
    const foot = document.querySelector("footer.site-footer");
    return {
      innerWidth: window.innerWidth,
      pageScrollW: document.documentElement.scrollWidth,
      container: sc.clientWidth, table: tbl.offsetWidth, tblScrollW: sc.scrollWidth,
      names, inputs, trendYearRightMargin,
      ratioTicks: rowOverlap('#chart [data-rt]'), headTicks: rowOverlap('#chart [data-nt]'),
      dcards,
      colsWidth: Math.round(cols.width), leftColWidth: Math.round(leftCol.width),
      footer: box("footer.site-footer"),
      footerInLeftCol: !!document.querySelector(".cols > div:first-child footer.site-footer"),
      disclaimOver: (() => { const e = foot && foot.querySelector(".disclaim"); return e ? e.scrollWidth - e.clientWidth : 0; })(),
      contactOver:  (() => { const e = foot && foot.querySelector(".contact"); return e ? e.scrollWidth - e.clientWidth : 0; })(),
      moneyOver, svgOver,
      caveat: box(".caveat"),
      caveatOutsideCols: !document.querySelector(".cols .caveat")
    };
  });
}

for (const w of [1280, 1440, 1680]) {
  test(`LAYOUT-${w} 標準幅：職種名・数値が欠けず、親幅に追従し右余白が出ない`, async () => {
    const m = await measure(w);
    for (const n of m.names) assert.ok(n.over <= 1, `${w}px: 職種名「${n.name}」が欠けている（超過 ${n.over}px）`);
    for (const i of m.inputs) assert.ok(i.over <= 1, `${w}px: 入力値「${i.v}」が欠けている（超過 ${i.over}px）`);
    assert.ok(m.container - m.table <= 3, `${w}px: テーブルとコンテナに余白 ${m.container - m.table}px（親幅に追従していない）`);
    assert.ok(m.tblScrollW <= m.container + 1, `${w}px: 標準幅で横スクロールが出ている`);
    assert.ok(m.pageScrollW <= m.innerWidth + 1, `${w}px: ページ本体が横にはみ出している`);
    assert.ok(m.trendYearRightMargin >= 20, `${w}px: 推移表「10年後」列が右端に張り付いている（右余白 ${m.trendYearRightMargin.toFixed(0)}px）`);
    assert.ok(m.ratioTicks.n >= 3, `${w}px: 配置比率の目盛りが少なすぎる（${m.ratioTicks.n}）`);
    assert.ok(m.ratioTicks.ov <= 1, `${w}px: 横軸 上段（配置比率）の目盛りラベルが重なっている（重なり ${m.ratioTicks.ov.toFixed(1)}px）`);
    assert.ok(m.headTicks.ov <= 1, `${w}px: 横軸 下段（常勤換算数）の目盛りラベルが重なっている（重なり ${m.headTicks.ov.toFixed(1)}px）`);
    // 両面カード：2枚あり、標準幅では横並び（top が揃う）・文字が欠けない
    assert.equal(m.dcards.length, 2, `${w}px: ジレンマ両面カードが2枚でない（${m.dcards.length}）`);
    for (const d of m.dcards) assert.ok(d.over <= 1, `${w}px: 両面カードの文字が欠けている（超過 ${d.over}px）`);
    assert.ok(Math.abs(m.dcards[0].top - m.dcards[1].top) <= 2, `${w}px: 両面カードが横並びになっていない`);
    // 免責・問い合わせは左カラムの最後にあり、文字が欠けない
    assert.ok(m.footerInLeftCol, `${w}px: 免責・問い合わせが左カラムに入っていない`);
    assert.ok(m.footer.over <= 1, `${w}px: フッターの文字が欠けている（超過 ${m.footer.over}px）`);
    assert.ok(m.disclaimOver <= 1, `${w}px: 免責一文が欠けている（超過 ${m.disclaimOver}px）`);
    assert.ok(m.contactOver <= 1, `${w}px: 問い合わせ導線が欠けている（超過 ${m.contactOver}px）`);
    assert.ok(m.footer.width <= m.leftColWidth + 2, `${w}px: フッターが左カラム幅を超えている（${m.footer.width} > ${m.leftColWidth}）`);
    // 「前提と出典の扱い」は左右をまたぐ全幅ブロック
    assert.ok(m.caveatOutsideCols, `${w}px: 前提と出典の扱いが .cols の中に残っている（全幅になっていない）`);
    assert.ok(m.caveat.width >= m.colsWidth - 2, `${w}px: 前提と出典の扱いが全幅でない（${m.caveat.width} < ${m.colsWidth}）`);
    assert.ok(m.caveat.width > m.leftColWidth * 1.5, `${w}px: 前提と出典の扱いが片カラム幅のまま（${m.caveat.width}）`);
    assert.ok(m.caveat.over <= 1, `${w}px: 前提と出典の扱いの文字が欠けている（超過 ${m.caveat.over}px）`);
    // 金額の単位「万円／年」で数値が欠けないこと（2026-07-29 の単位追記）
    for (const x of m.moneyOver) assert.ok(x.over <= 1, `${w}px: 金額表示「${x.t}」が欠けている（超過 ${x.over}px）`);
    for (const x of m.svgOver)   assert.ok(x.over <= 1, `${w}px: グラフ内の文字「${x.t}」が描画域からはみ出している（${x.over}px）`);
  });
}

test("LAYOUT-narrow 狭幅：切って隠さず、横スクロールで逃がす", async () => {
  const m = await measure(360);
  for (const n of m.names) assert.ok(n.over <= 1, `狭幅: 職種名「${n.name}」が欠けている（超過 ${n.over}px）`);
  for (const i of m.inputs) assert.ok(i.over <= 1, `狭幅: 入力値「${i.v}」が欠けている（超過 ${i.over}px）`);
  assert.ok(m.tblScrollW > m.container + 1, `狭幅で横スクロールが出ていない（container ${m.container} / scrollW ${m.tblScrollW}）＝切れて隠れている疑い`);
  // 両面カードは狭幅では縦積み（top がずれる）・文字が欠けない
  assert.equal(m.dcards.length, 2, `狭幅: ジレンマ両面カードが2枚でない（${m.dcards.length}）`);
  for (const d of m.dcards) assert.ok(d.over <= 1, `狭幅: 両面カードの文字が欠けている（超過 ${d.over}px）`);
  assert.ok(Math.abs(m.dcards[0].top - m.dcards[1].top) > 2, `狭幅: 両面カードが縦積みになっていない（横並びのまま）`);
  // 移動後も狭幅で欠けない（縦積み＝カラム幅＝画面幅になる）
  assert.ok(m.footerInLeftCol, `狭幅: 免責・問い合わせが左カラムに入っていない`);
  assert.ok(m.disclaimOver <= 1, `狭幅: 免責一文が欠けている（超過 ${m.disclaimOver}px）`);
  assert.ok(m.contactOver <= 1, `狭幅: 問い合わせ導線が欠けている（超過 ${m.contactOver}px）`);
  for (const x of m.moneyOver) assert.ok(x.over <= 1, `狭幅: 金額表示「${x.t}」が欠けている（超過 ${x.over}px）`);
  for (const x of m.svgOver)   assert.ok(x.over <= 1, `狭幅: グラフ内の文字「${x.t}」が描画域からはみ出している（${x.over}px）`);
  assert.ok(m.caveat.over <= 1, `狭幅: 前提と出典の扱いの文字が欠けている（超過 ${m.caveat.over}px）`);
  assert.ok(m.caveatOutsideCols, `狭幅: 前提と出典の扱いが .cols の中に残っている`);
});

/* スマホ実機（iPhone エミュレーション・touch）：職種表(min-width)がページ全体を広げず、本体が
   device-width に収まること（body overflow-x:hidden の回帰ガード）。表は .tbl-scroll 内で横スクロール可。 */
test("LAYOUT-mobile iPhone幅でページ本体が横に広がらない（表は内部スクロール）", async () => {
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.goto(fileUrl, { waitUntil: "load" });
  const m = await page.evaluate(() => {
    const s = document.querySelector(".tbl-scroll");
    return {
      inner: window.innerWidth, pageScrollW: document.documentElement.scrollWidth,
      tblContainer: s.clientWidth, tblScrollW: s.scrollWidth,
      moneyOver: [...document.querySelectorAll(".readout .row .v,#marginal .row .k,#marginal .row .v,#ratiobar .cell .s,.field .inline")]
        .map(e => ({ t: e.textContent.trim().slice(0, 40), over: e.scrollWidth - e.clientWidth }))
    };
  });
  assert.ok(m.pageScrollW <= m.inner + 1, `iPhone幅: ページ本体が横にはみ出している（scrollW ${m.pageScrollW} / inner ${m.inner}）`);
  assert.ok(m.inner <= 391, `iPhone幅: 本体幅が device-width(390) を超えて広がっている（inner ${m.inner}）`);
  assert.ok(m.tblScrollW > m.tblContainer + 1, `iPhone幅: 職種表が .tbl-scroll 内で横スクロールできない（切れて隠れている疑い）`);
  for (const x of m.moneyOver) assert.ok(x.over <= 1, `iPhone幅: 金額表示「${x.t}」が欠けている（超過 ${x.over}px）`);
});
