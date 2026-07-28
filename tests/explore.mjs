#!/usr/bin/env node
/* ランダム入力での探索テスト。dayservice-sim の 10,000 ケース探索と同じ考え方で、
   不変条件を破る入力を機械に探させる。失敗したら再現用の入力をそのまま出力する。 */
import { SERVICES, initialRows, calcState } from "../engine.mjs";
import { DEFAULT_SIZES, near, fillStd } from "./helpers.mjs";

const N = Number(process.argv[2] ?? 10000);
const SEED = Number(process.argv[3] ?? 20260726);

/* 再現性のある擬似乱数（mulberry32） */
let st = SEED >>> 0;
const rnd = () => { st = (st + 0x6D2B79F5) >>> 0; let t = st; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)];
const between = (lo, hi) => lo + rnd() * (hi - lo);

function randomInput() {
  const service = pick(Object.keys(SERVICES));
  const svc = SERVICES[service];
  const sizes = { ...DEFAULT_SIZES[service] };
  for (const f of svc.fields) {
    if (f.k === "occ") sizes.occ = Math.round(between(40, 100));
    else if (f.k === "cap") sizes.cap = Math.round(between(1, 200));
    else if (f.k === "units") sizes.units = Math.round(between(1, 12));
    else if (f.k === "hours") sizes.hours = Math.round(between(3, 12) * 2) / 2;
    else if (f.k === "days") sizes.days = Math.round(between(1, 7));
  }
  const week = Math.round(between(30, 48));
  const rows = initialRows(service, sizes, week).map(r => ({
    ...r,
    n:     Math.max(0, Math.round(r.n * between(0, 2.2) * 10) / 10),
    hi:    Math.round(between(0, 8) * 10) / 10,
    haken: Math.round(between(0, 5) * 10) / 10   // v0.5: 派遣人数（配置基準に算入・原資配分外）
  }));
  const total = Math.round(between(0, 60000));
  return {
    service, sizes, week,
    rev: Math.round(between(0, 90000)),      // 収益・人件費総額ともに実額入力（率は出力）
    total,
    hakenFee: Math.round(between(0, total)),  // 人件費総額の内数（engine 側で total にクランプ）
    fuku: Math.round(between(0, 30) * 10) / 10,
    bonus: Math.round(between(0, 8) * 10) / 10,
    scale: Math.round(between(0.4, 1.8) * 1000) / 1000,
    nminAuto: rnd() < 0.6,
    nminManual: Math.round(between(0, 120) * 10) / 10,
    atgt: Math.round(between(0, 900)),
    g: Math.round(between(0, 10) * 10) / 10,
    rows
  };
}

const CHECKS = [
  ["職員数＝正規＋非正規＋派遣（fteAll）", (c) => near(c.baseS + c.baseH, c.baseN) && near(c.nSe + c.nHi + c.nHk, c.n)],
  ["数値にNaNがない", (c) => Object.values(c).every(v => typeof v !== "number" || !Number.isNaN(v))
      && c.rows.every(r => !Number.isNaN(r.totalFte))
      && c.proj.horizons.every(x => Number.isFinite(x.ratio) && Number.isFinite(x.delta))
      && ["delta","revUp","rate","cutN"].every(k => Number.isFinite(c.proj.absorb[k]))],
  ["職員数×1人あたり給与費＝人件費総額", (c) => near(c.n * c.avg, c.total, 1e-6)],
  ["給与原資×(1+負担率)＋派遣費＝人件費総額", (c, I) => near(c.pool * (1 + I.fuku / 100) + c.hakenFee, c.total, 1e-6)],
  ["未達なしなら全職種で基準以上", (c) => c.shorts.length > 0 || c.blocked
      || c.rows.every(r => !(r.std > 0) || r.totalFte >= r.std - 1e-9)],
  ["未達ありなら該当職種が実際に不足", (c) => c.shorts.every(x => {
      const r = c.rows.find(y => y.name === x.name); return r && r.totalFte < r.std - 1e-9; })],
  ["配置比率の分母は正規＋非正規", (c) => !c.svc.ratio || near(c.coreN,
      c.rows.filter(r => c.svc.ratio.roles.includes(r.key)).reduce((a, r) => a + r.totalFte, 0))],
  ["A の分母は正規＋非正規＋派遣", (c) => near(c.A, c.fteAll > 0 ? c.total / c.fteAll : 0, 1e-8)],
  ["賃金下限は額面×(1+法定福利費率)", (c, I) => near(c.floorA, I.atgt * (1 + I.fuku / 100), 1e-9)],
  ["構成考慮の下限≧基準の単純合計", (c) => !isFinite(c.nMinComp) || c.nMinComp >= c.stdN - 1e-9],
  ["成立判定が下限と上限に整合", (c) => c.feasible === (c.nmin <= c.nCap + 1e-9)],
  ["スケールで給与原資が変わらない", (c, I) => near(calcState({ ...I, scale: I.scale * 1.37 }).pool, c.pool)],
  ["雇用区分の入替で原資が変わらない", (c, I) => {
      const rows = I.rows.map(r => { const t = r.n + r.hi; return { ...r, n: t * 0.3, hi: t * 0.7 }; });
      const d = calcState({ ...I, rows });
      return near(d.pool, c.pool) && near(d.total, c.total) && near(d.n, c.n); }],
  ["不足を埋めると未達が解消", (c, I) => calcState(fillStd(I)).shorts.length === 0 || !!c.blocked],
  ["賃金の余裕 ＝ A ÷ 賃金下限(事業主負担込み)", (c, I) => !(I.atgt > 0) || near(c.slackWage, c.A / c.floorA, 1e-9)]
];

let fails = 0;
const seen = new Set();
for (let i = 0; i < N; i++) {
  const I = randomInput();
  let c;
  try { c = calcState(I); }
  catch (e) { console.error(`\n[例外] case ${i}: ${e.message}\n` + JSON.stringify(I)); fails++; continue; }
  for (const [name, fn] of CHECKS) {
    let ok;
    try { ok = fn(c, I); } catch (e) { ok = false; }
    if (!ok) {
      fails++;
      if (!seen.has(name)) {
        seen.add(name);
        console.error(`\n[違反] ${name}  (case ${i})`);
        console.error("再現用の入力:\n" + JSON.stringify(I, null, 1));
      }
    }
  }
}

console.log(`探索 ${N} ケース / 不変条件 ${CHECKS.length} 件 → 違反 ${fails} 件` +
  (seen.size ? `（種類: ${[...seen].join(" / ")}）` : ""));
process.exit(fails ? 1 : 0);
