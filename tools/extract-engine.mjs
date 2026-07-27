#!/usr/bin/env node
/* jinkenhi-sim.html の SWMD-ENGINE 区間を engine.mjs として抜き出す。
   本体は単一HTMLのまま（GitHub Pages でそのまま公開できる状態）を維持し、
   テストはこの抜き出したモジュールに対して実行する。 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src  = readFileSync(resolve(root, "jinkenhi-sim.html"), "utf8");

const B = "/* ===== SWMD-ENGINE:BEGIN =====";
const E = "/* ===== SWMD-ENGINE:END ===== */";
const i = src.indexOf(B), j = src.indexOf(E);
if (i < 0 || j < 0) { console.error("ENGINEマーカーが見つかりません"); process.exit(1); }

const block = src.slice(i, j + E.length);

/* DOM依存の混入ガード。コメントは除いてから走査する（注意書き自体に語が出るため） */
const code = block.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
for (const bad of ["document", "window", "getElementById", "localStorage", "fetch("]) {
  if (code.includes(bad)) {
    console.error(`ENGINE区間にDOM依存が混入しています: ${bad}`);
    process.exit(1);
  }
}

writeFileSync(resolve(root, "engine.mjs"),
  "/* 自動生成 — 直接編集しないこと。生成元: jinkenhi-sim.html */\n" +
  block + "\n\nexport default ENGINE;\n" +
  "export const { SERVICES, buildStandard, calcState, initialRows, scaleRows,\n" +
  "  scaleCoreToRatio, staffNAtRatio, bAtRatio, ratioAtStaffN } = ENGINE;\n");

console.log(`engine.mjs を生成しました（${block.split("\n").length} 行）`);
