import { SERVICES, initialRows, calcState } from "../engine.mjs";

export const DEFAULT_SIZES = {
  tokuyou: { cap: 80, occ: 96 },
  unit:    { cap: 80, occ: 96, units: 8 },
  roken:   { cap: 100, occ: 92 },
  tsuusho: { cap: 35, occ: 88, hours: 7, days: 6 }
};

/** 既定の入力一式。上書きしたい項目だけ渡す（undefined は無視する）。 */
export function makeInput(service = "tokuyou", over = {}) {
  const svc = SERVICES[service];
  const sizes = { ...DEFAULT_SIZES[service], ...(over.sizes || {}) };
  const week = over.week ?? 40;
  const clean = Object.fromEntries(Object.entries(over).filter(([, v]) => v !== undefined));
  const base = {
    service, sizes, week,
    mode: "ratio", autoRev: true,
    price: svc.unitPrice, rev: svc.defRev, ratio: svc.bench, total: 0,
    fuku: 16.5, bonus: 4, hiW: 70,
    scale: 1, nminAuto: true, nminManual: 0, atgt: 400,
    rows: initialRows(service, sizes, week)
  };
  return { ...base, ...clean, sizes, week };
}

export const run = (service, over) => calcState(makeInput(service, over));
export const near = (a, b, eps = 1e-6) =>
  Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));

/** 不足職種を正規側で埋める（UIの「不足職種を基準まで埋める」と同じ操作） */
export function fillStd(I) {
  const c = calcState(I);
  const rows = I.rows.map((r, i) => {
    const std = c.rows[i]?.std;
    if (!std || std <= 0) return { ...r };
    const need = std / (I.scale || 1), tot = r.n + (r.hi || 0);
    return tot < need ? { ...r, n: Math.ceil((r.n + (need - tot)) * 10) / 10 } : { ...r };
  });
  return { ...I, rows };
}

/** 賃金倍率を1.000に合わせる（UIの「入力した基準年収どおりにする」と同じ操作） */
export function fitWage(I) {
  const c = calcState(I);
  let Bs = 0, Bh = 0;
  c.rows.forEach(r => { Bs += r.n * r.a; Bh += r.hi * r.a * c.hw; });
  const needTotal = (Bs + Bh) * I.scale * (1 + I.fuku / 100);
  return I.mode === "direct"
    ? { ...I, total: needTotal }
    : { ...I, ratio: c.rev > 0 ? needTotal / c.rev * 100 : I.ratio };
}
