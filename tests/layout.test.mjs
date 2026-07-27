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
const htmlPath = process.env.LAYOUT_HTML ? resolve(process.env.LAYOUT_HTML) : resolve(root, "jinkenhi-sim.html");
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
    const sl = document.getElementById("scale"); sl.value = "1.7"; fire(sl, "input"); // 実配置をスケール
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
    return {
      innerWidth: window.innerWidth,
      pageScrollW: document.documentElement.scrollWidth,
      container: sc.clientWidth, table: tbl.offsetWidth, tblScrollW: sc.scrollWidth,
      names, inputs, trendYearRightMargin
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
  });
}

test("LAYOUT-narrow 狭幅：切って隠さず、横スクロールで逃がす", async () => {
  const m = await measure(360);
  for (const n of m.names) assert.ok(n.over <= 1, `狭幅: 職種名「${n.name}」が欠けている（超過 ${n.over}px）`);
  for (const i of m.inputs) assert.ok(i.over <= 1, `狭幅: 入力値「${i.v}」が欠けている（超過 ${i.over}px）`);
  assert.ok(m.tblScrollW > m.container + 1, `狭幅で横スクロールが出ていない（container ${m.container} / scrollW ${m.tblScrollW}）＝切れて隠れている疑い`);
});
