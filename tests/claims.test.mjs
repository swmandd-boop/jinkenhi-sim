/**
 * claims.test.mjs — 画面整合の機械検査（release-gate STAGE 1.6 対応）
 *
 * 「同じ画面の2つの表示が違うことを言っていないか」を機械で確認する。
 * docs/claims.test.mjs.template を、この実装の engine 返り値・DOM 構造に合わせたもの。
 *
 * 【テンプレートから変えた点】
 * - 観測点：テンプレートの [data-band] / [data-short] はこの実装に存在しない。
 *   **新しい目印を足さず、いま画面にあるものだけで観測する**（教訓 E-018）。
 *     帯      → 緑の path（stroke="#2A7F72"）
 *     不足    → 充足判定パネル #compliance の見出し文言
 *     警告色  → #ratiobar .cell.warn
 *     区間なし→ グラフ内の「区間がありません」（v0.3 の「両立する区間なし」から改称済み）
 * - render()：mutate は「現在のロスターを見て差分を返す」形にした。
 *   テンプレートの I.rows.map(...) を成立させるには実際の rows が要るため、
 *   サービス切替後の engine 状態を渡してから差分を DOM 操作に翻訳する。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HTML = readFileSync(resolve(root, "index.html"), "utf8");

/* ============================================================
   1.6-1 主張の列挙
   engine 側＝計算の結論、UI 側＝実際に描画された結果。
   両者を別々に取り、下の PAIRS で突き合わせる。
   ============================================================ */

function claims(c, d) {
  const chart = d.getElementById("chart");
  const h3 = (sel) => {
    const e = d.querySelector(sel + " h3");
    return e ? e.textContent : "";
  };
  const anchorTxt = (() => {
    const e = d.getElementById("anchor");
    return e && !e.hidden ? e.textContent : "";
  })();

  return {
    // --- engine 側の主張（計算の結論） ---
    feasible:      !!c.feasible,                                  // 配置下限と賃金下限が両立する
    isCompliant:   c.shorts.length === 0 && !c.blocked,           // 職種別の基準を満たす
    ratioOk:       !c.ratioBad,                                   // 配置比率が基準内
    hasSlackN:     isFinite(c.nMinComp) && c.slackN >= -1e-9,     // 配置に余裕がある（0含む）
    wageOk:        !!c.okA,                                       // 1人あたり給与費が賃金下限以上

    // --- UI 側の観測（描画された結果） ---
    chartDrawn:      !!(chart && chart.querySelector('path[stroke-dasharray]')),  // 曲線が引けている
    bandDrawn:       !!(chart && [...chart.querySelectorAll("path")]
                       .some((e) => e.getAttribute("stroke") === "#2A7F72")),
    noBandTextShown: /区間(なし|がありません)/.test(chart ? chart.textContent : ""),
    complianceOk:    h3("#compliance").includes("満たしています"),
    verdictFeasible: h3("#verdict").includes("成立する幅"),
    ratioWarned:     !!d.querySelector("#ratiobar .cell.warn"),
    slackShown:      anchorTxt.includes("配置の余裕"),
    wageShortNoted:  (d.getElementById("verdict") || {}).textContent
                       ? d.getElementById("verdict").textContent.includes("1人あたり給与費が下限") : false,
  };
}

/* ============================================================
   1.6-2 主張どうしの整合（左辺 ⟺ 右辺）
   ============================================================ */

/* 4番目の要素は「前提」。その主張が true のときだけ突き合わせる。
   テンプレートには無い形だが、グラフが描けない状態（介護・看護が0人で配置比率が
   定義できない等）では帯も「区間がありません」も出ないのが正しいため、前提なしでは
   等価にならない。前提なしで書くと**正常な状態を矛盾として報告してしまう**。 */
const PAIRS = [
  ["bandDrawn",   "!noBandTextShown", "帯が描かれる ⟺ 「区間がありません」が出ない", "chartDrawn"],
  ["isCompliant", "complianceOk",     "職種別を満たす ⟺ 充足判定が「満たしています」"],
  ["ratioOk",     "!ratioWarned",     "比率が基準内 ⟺ 指標バーが警告色でない"],
  ["feasible",    "verdictFeasible",  "両立する ⟺ 判定欄が「成立する幅」"],
  ["hasSlackN",   "slackShown",       "配置に余裕がある ⟺ §6 が「配置の余裕」を出す"],
  ["wageOk",      "!wageShortNoted",  "賃金下限を満たす ⟺ 判定欄が賃金不足を書かない", "verdictFeasible"],
];

/* ============================================================
   走査対象：全サービス × 境界値 × 偏った構成
   ============================================================ */

const SERVICES = ["tokuyou", "unit", "roken", "tsuusho"];

const PATTERNS = [
  { name: "初期状態",       mutate: (I) => I },
  { name: "端点・左",       mutate: (I) => ({ ...I, knob: 0 }) },
  { name: "端点・右",       mutate: (I) => ({ ...I, knob: 1 }) },
  { name: "偏った構成",     mutate: (I) => ({ ...I,
      rows: I.rows.map((r, i) => i === 0 ? { ...r, n: r.n * 0.3 } : r) }) },
  { name: "その他だけ薄い", mutate: (I) => ({ ...I,
      rows: I.rows.map((r) => r.key === "other" ? { ...r, n: r.n * 0.4 } : r) }) },
  { name: "賃金下限が高い", mutate: (I) => ({ ...I, atgt: 900 }) },
  { name: "賃金下限が0",    mutate: (I) => ({ ...I, atgt: 0 }) },
  { name: "基準職種が0",    mutate: (I) => ({ ...I,
      rows: I.rows.map((r) => r.std > 0 ? { ...r, n: 0, hi: 0 } : r) }) },
];

/* ============================================================
   テスト本体
   ============================================================ */

function evalPair(v, key) {
  return key.startsWith("!") ? !v[key.slice(1)] : v[key];
}

test("CLAIM-01 主張どうしが矛盾しない（全サービス × 全パターン）", () => {
  const violations = [];
  for (const svc of SERVICES) {
    for (const p of PATTERNS) {
      const { c, d } = render(svc, p.mutate);
      const v = claims(c, d);
      for (const [lhs, rhs, label, when] of PAIRS) {
        if (when && !evalPair(v, when)) continue;
        if (evalPair(v, lhs) !== evalPair(v, rhs)) {
          violations.push(`${svc} / ${p.name} / ${label}` +
            `（${lhs}=${evalPair(v, lhs)} ≠ ${rhs}=${evalPair(v, rhs)}）`);
        }
      }
    }
  }
  assert.deepEqual(violations, [], "\n" + violations.join("\n"));
});

test("CLAIM-02 網羅性：突き合わせていない主張がない（E-016）", () => {
  const { c, d } = render(SERVICES[0], (I) => I);
  const all = Object.keys(claims(c, d));
  const covered = new Set(PAIRS.flatMap(([l, r, , when]) =>
    [l, r, when].filter(Boolean).map((k) => k.replace(/^!/, ""))));
  const uncovered = all.filter((k) => !covered.has(k));
  assert.deepEqual(uncovered, [],
    `\n次の主張が PAIRS に出てきません。整合条件を定義するか、` +
    `主張でないなら claims() から外してください：\n  ${uncovered.join("\n  ")}`);
});

test("CLAIM-03 端点を連続で踏んでも壊れない", () => {
  // 1回踏むだけでは発散しない不具合がある（探索1万件が見逃した実例＝ゼロ除算の軸暴走）
  for (const svc of SERVICES) {
    const { c, d } = render(svc, (I) => ({ ...I, knobSeq: 40 }));
    const v = claims(c, d);
    for (const [k, val] of Object.entries(v)) {
      assert.equal(typeof val, "boolean", `${svc} ${k} が真偽値でない`);
    }
    /* d.body.textContent は <script> の中身（engine のソース）まで拾ってしまい、
       コード中の undefined / Infinity で必ず落ちる。**表示されるテキストだけ**を見る。 */
    const visible = [...d.body.querySelectorAll("*")]
      .filter((e) => !e.children.length && !/^(SCRIPT|STYLE)$/.test(e.tagName))
      .map((e) => e.textContent).join(" ");
    assert.ok(!/NaN|Infinity|undefined/.test(visible),
      `${svc} 画面に NaN/Infinity/undefined が出ている`);
    assert.ok(isFinite(c.n) && c.n >= 0, `${svc} 職員数が壊れている（${c.n}）`);
  }
});

test("CLAIM-04 UI層に判定式が書かれていない（E-015）", () => {
  // 主張は engine が返すもの。UI が独自に判定していたら二重管理
  const uiStart = HTML.indexOf("SWMD-UI:BEGIN");
  const uiEnd = HTML.indexOf("SWMD-UI:END");
  assert.ok(uiStart > 0 && uiEnd > uiStart, "UI区間のマーカーが見つからない");
  const ui = HTML.slice(uiStart, uiEnd)
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

  /* 「> 0」「>= 0」は値の有無ガード＝表示の分岐で、テンプレートも許容している。
     判定として見るのは**しきい値・基準との比較**に絞る。 */
  const suspicious = [
    [/\bshorts\s*\.\s*length\s*[<>=]/,               "不足件数の再判定"],
    [/\bratio\w*\s*[<>]=?\s*(?!0\b)[\w.]/,            "比率と基準の比較"],
    [/\bn\w*\s*>=\s*n(min|Cap)\b/i,                  "成立範囲の再判定"],
  ];
  const hits = suspicious.filter(([re]) => re.test(ui)).map(([, name]) => name);
  assert.deepEqual(hits, [],
    "\nUI層に判定式があります。engine に移して真偽値を受け取ってください");

  /* ★この検査の限界（E-001）。文字列パターンによるヒューリスティックであり、
     「UI層に判定式が無いこと」を証明しない。実際、renderChart の inBand は
     `R <= nx.ax.base`（比率が基準以下）と `n >= nx.nbase`（合計が基準以上）を
     UI層で評価しているが、**変数名が R / n のため上のパターンには掛からない**。
     これは軸上の任意の点についての評価で engine の真偽値では代替できない一方、
     現在地の判定（gapwarn）にも同じ関数を使っており、比率の部分は engine の
     ratioBad と意味が重なる。engine へ移すかどうかは判断待ち（報告済み）。 */
});

/* ============================================================
   描画ヘルパ（この実装に合わせたもの）
   mutate は現在のロスターを受け取り、差分を返す。
   返した差分だけを DOM 操作に翻訳する（座標クリックはしない・E-009）。
   ============================================================ */

function render(service, mutate) {
  const dom = new JSDOM(HTML, { runScripts: "dangerously", pretendToBeVisual: true });
  const d = dom.window.document;
  const fire = (el, t) => el.dispatchEvent(new dom.window.Event(t, { bubbles: true }));
  const setVal = (el, v, ev) => { el.value = String(v); fire(el, ev || "input"); };

  const sel = d.getElementById("svc");
  sel.value = service;
  fire(sel, "change");

  // mutate には切替後の実ロスターを渡す（rows.std / rows.key を見た分岐を成立させるため）
  const base = dom.window.__SWMD_STATE();
  const I = mutate({
    knob: null, knobSeq: null, atgt: null,
    rows: base.rows.map((r) => ({ key: r.key, std: r.std, n: r.n, hi: r.hi, haken: r.haken }))
  }) || {};

  if (I.rows) {
    I.rows.forEach((r, i) => {
      const b = base.rows[i];
      for (const f of ["n", "hi", "haken"]) {
        if (Math.abs(r[f] - b[f]) < 1e-9) continue;
        const el = d.querySelector(`[data-i="${i}"][data-f="${f}"]`);
        if (el) setVal(el, r[f]);
      }
    });
  }
  if (I.atgt != null) setVal(d.getElementById("atgt"), I.atgt);
  if (I.knob != null) {
    const bar = d.getElementById("scale");
    setVal(bar, I.knob);
    fire(bar, "change");                       // つまみを離して確定
  }
  if (I.knobSeq != null) {                     // 端点を連続で踏む
    const bar = d.getElementById("scale");
    for (let k = 0; k < I.knobSeq; k++) {
      setVal(bar, k % 2 === 0 ? 0 : 1);
      fire(bar, "change");
    }
  }

  return { c: dom.window.__SWMD_STATE(), d };
}
