#!/usr/bin/env node
/* adversarial-review モード2（画面矛盾探し）用の材料を作る。
   代表シナリオでツールを1周させ、各場面の全表示値をテキストに書き出す。
   E-009 準拠: 座標クリックはせず、DOM要素を特定してからイベントを発火させる。 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(resolve(root, "jinkenhi-sim.html"), "utf8");
const dom  = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true });
const { document: d, Event } = dom.window;

const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
const setVal = (id, v) => { const el = d.getElementById(id); el.value = String(v); fire(el, "input"); };
const setRow = (i, field, v) => {
  const el = d.querySelectorAll(`[data-i="${i}"][data-f="${field}"]`)[0];
  el.value = String(v); fire(el, "input");
};
const click = (id) => d.getElementById(id).click();
const selectService = (key) => { const s = d.getElementById("svc"); s.value = key; fire(s, "change"); };

/* 画面上に出ている値をすべて拾う */
function snapshot(title) {
  const L = [`===== ${title} =====`];
  L.push("-- 入力 --");
  for (const el of d.querySelectorAll("input, select")) {
    if (el.type === "range" || el.closest("#tbody")) continue;
    const lab = d.querySelector(`label[for="${el.id}"]`);
    const name = lab ? lab.textContent.trim() : (el.id || el.name || "?");
    const v = el.type === "checkbox" ? (el.checked ? "ON" : "OFF") : el.value;
    L.push(`${name}: ${v}${el.readOnly ? "（読み取り専用）" : ""}`);
  }
  L.push("-- 指標バー --");
  for (const c of d.querySelectorAll("#ratiobar .cell")) {
    L.push(`${c.querySelector(".k").textContent.trim()} = ${c.querySelector(".v").textContent.trim()}` +
           ` / ${c.querySelector(".s").textContent.trim()}` + (c.classList.contains("warn") ? "  [警告表示]" : ""));
  }
  L.push("-- 職種別基準の判定 --");
  L.push(d.getElementById("compliance").textContent.replace(/\s+/g, " ").trim());
  L.push("-- 成立判定 --");
  L.push(d.getElementById("verdict").textContent.replace(/\s+/g, " ").trim());
  L.push("-- 必要人件費率 --");
  L.push(d.getElementById("need-ratio").textContent.replace(/\s+/g, " ").trim());
  L.push("-- 定点の位置づけ --");
  L.push(d.getElementById("anchor").textContent.replace(/\s+/g, " ").trim());
  L.push("-- 雇用区分 --");
  for (const r of d.querySelectorAll("#emp-readout .row"))
    L.push(`${r.querySelector(".k").textContent.trim()} = ${r.querySelector(".v").textContent.trim()}`);
  L.push("-- 限界トレードオフ --");
  for (const r of d.querySelectorAll("#marginal .row"))
    L.push(`${r.querySelector(".k").textContent.trim()} = ${r.querySelector(".v").textContent.trim()}`);
  L.push("-- 推移 --");
  L.push(d.getElementById("trend").textContent.replace(/\s+/g, " ").trim());
  L.push("-- 職種別の内訳 --");
  const th = [...d.querySelectorAll("#tbl thead th")].map(x => x.textContent.replace(/\s+/g, "")).filter(Boolean);
  L.push(th.join(" | "));
  for (const tr of d.querySelectorAll("#tbody tr")) {
    L.push([...tr.children].map(td => {
      const inp = td.querySelector("input");
      if (inp) return inp.value;
      const btn = td.querySelector("button");
      if (btn) return "";
      return (td.querySelector(".rolename")?.textContent ?? td.textContent).trim();
    }).filter(x => x !== "").join(" | "));
  }
  const tf = [...d.querySelectorAll("#tbl tfoot td")].map(x => x.textContent.trim()).filter(Boolean);
  L.push("合計行: " + tf.join(" | "));
  L.push("-- 曲線の注記 --");
  L.push([...d.querySelectorAll("#chart text")].map(t => t.textContent).filter(t => /下限|基準|人|万円|区間/.test(t)).join(" / "));
  L.push("-- 配置下限の説明 --");
  L.push(d.getElementById("nmin-note").textContent.replace(/\s+/g, " ").trim());
  return L.join("\n");
}

/* 代表シナリオ（1周） */
const shots = [];
shots.push(snapshot("01 起動直後：特養 従来型 80床・実配置＝基準"));

setRow(4, "n", 31); setRow(8, "n", 3); setRow(9, "n", 2);
shots.push(snapshot("02 介護職員31・調理3・事務2 を入れて実態に寄せる"));

setRow(4, "n", 20); setRow(4, "hi", 11);
shots.push(snapshot("03 介護職員を正規20／非正規11 に分ける"));

setVal("sz-cap", 100);
shots.push(snapshot("04 定員だけ100に変更（構成は据え置き＝基準未達が出る想定）"));

click("fill-std");
shots.push(snapshot("05 「不足職種を基準まで埋める」を押す"));

setVal("ratio", 39.4);
shots.push(snapshot("06 人件費率を39.4に下げる（両立しない領域へ）"));

setVal("nmin", 30);
shots.push(snapshot("07 配置下限を手入力30に下げる（自動追従を切る）"));

click("use-std");
shots.push(snapshot("08 「基準を満たす最小に戻す」を押す"));

setVal("scale", 1.6);
fire(d.getElementById("scale"), "change"); // スライダーを離す＝倍率を実配置に確定
shots.push(snapshot("09 職員数スライダーを1.6倍に（離して確定）"));

d.getElementById("mode-direct").click();
shots.push(snapshot("10 原資を「人件費総額を直接」に切り替え"));

d.getElementById("mode-ratio").click();
selectService("unit");
shots.push(snapshot("11 ユニット型に切り替え"));

selectService("roken");
shots.push(snapshot("12 老健に切り替え"));

selectService("tsuusho");
setVal("sz-days", 5);
setVal("atgt", 420);   // 下回れない平均年収を入力（賃金の余裕を表示）
setVal("g", 2.0);      // 人件費の年間上昇率2.0%で推移を動かす
shots.push(snapshot("13 通所介護・週5日／平均年収下限420・年上昇率2.0%"));

click("mk");
shots.push("===== 14 書き出しテキスト =====\n" + d.getElementById("out").value);

mkdirSync(resolve(root, "review"), { recursive: true });
const out = resolve(root, "review", "screen-dump.txt");
writeFileSync(out,
  "SWMD 人件費トレードオフ・シミュレーター v0.3 画面表示値ダンプ\n" +
  "adversarial-review モード2（画面矛盾探し）用。codex 側にはこのテキストを渡す。\n" +
  `生成日時: ${new Date().toISOString()}\n\n` + shots.join("\n\n"));
console.log(`review/screen-dump.txt を生成しました（${shots.length} 場面 / ${shots.join("").length.toLocaleString()} 文字）`);
