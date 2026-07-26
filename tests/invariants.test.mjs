import { test } from "node:test";
import assert from "node:assert/strict";
import { SERVICES, calcState } from "../engine.mjs";
import { makeInput, run, near, fillStd, fitWage } from "./helpers.mjs";

const ALL = Object.keys(SERVICES);

/* ---- 不変条件1: 正規計＋非正規計＝合計 ---- */
test("INV-01 正規と非正規の合計が総数に一致する", () => {
  for (const s of ALL) {
    const c = run(s, { hiW: 70 });
    assert.ok(near(c.baseS + c.baseH, c.baseN), s);
    assert.ok(near(c.nSe + c.nHi, c.n), s);
  }
});

/* ---- 不変条件2: 充足判定と職種別の実数が矛盾しない ---- */
test("INV-02 未達なしと判定したら全職種で基準以上", () => {
  for (const s of ALL) {
    for (const scale of [0.4, 0.7, 1, 1.3, 1.8]) {
      const c = run(s, { scale });
      if (c.shorts.length === 0 && !c.blocked) {
        for (const r of c.rows) {
          if (r.std > 0) assert.ok(r.totalFte >= r.std - 1e-9, `${s} scale=${scale} ${r.name}`);
        }
      }
    }
  }
});

/* ---- 不変条件3: 配置比率の分母は正規＋非正規 ---- */
test("INV-03 配置比率の分母に非正規が含まれる", () => {
  for (const s of ALL) {
    const I = makeInput(s);
    I.rows = I.rows.map(r => ({ ...r, hi: r.n * 0.4, n: r.n * 0.6 }));
    const c = calcState(I);
    if (!c.svc.ratio) continue;
    const expect = c.rows
      .filter(r => c.svc.ratio.roles.includes(r.key))
      .reduce((a, r) => a + r.totalFte, 0);
    assert.ok(near(c.coreN, expect), s);
  }
});

/* ---- 不変条件4: 合計常勤換算 × 平均年収 ＝ 給与原資（曲線の定義） ---- */
test("INV-04 人数 × 平均年収 = 給与原資", () => {
  for (const s of ALL) {
    for (const scale of [0.5, 1, 1.7]) {
      const c = run(s, { scale });
      assert.ok(near(c.n * c.avg, c.pool, 1e-9), `${s} scale=${scale}`);
    }
  }
});

/* ---- 不変条件5: 給与原資 × (1+法定福利費率) ＝ 人件費総額 ---- */
test("INV-05 給与原資に事業主負担を戻すと人件費総額になる", () => {
  for (const s of ALL) {
    for (const fuku of [0, 16.5, 19, 25]) {
      const c = run(s, { fuku });
      assert.ok(near(c.pool * (1 + fuku / 100), c.total), `${s} fuku=${fuku}`);
    }
  }
});

/* ---- 不変条件6: スケールを変えても給与原資は不変 ---- */
test("INV-06 人数を動かしても給与原資は変わらない", () => {
  for (const s of ALL) {
    const base = run(s, { scale: 1 }).pool;
    for (const scale of [0.4, 0.9, 1.5, 1.8]) {
      assert.ok(near(run(s, { scale }).pool, base), `${s} scale=${scale}`);
    }
  }
});

/* ---- 不変条件7: 非正規比率を変えても人件費総額と給与原資は不変 ---- */
test("INV-07 雇用区分の内訳を変えても原資は変わらない", () => {
  for (const s of ALL) {
    const base = run(s);
    for (const share of [0, 0.25, 0.5, 0.9]) {
      const I = makeInput(s);
      I.rows = I.rows.map(r => ({ ...r, n: r.n * (1 - share), hi: r.n * share }));
      const c = calcState(I);
      assert.ok(near(c.total, base.total), `${s} share=${share} total`);
      assert.ok(near(c.pool, base.pool), `${s} share=${share} pool`);
      assert.ok(near(c.n, base.n), `${s} share=${share} n`);
    }
  }
});

/* ---- 不変条件8: 非正規年収 ＝ 正規年収 × 賃金水準 ---- */
test("INV-08 非正規年収は正規年収に賃金水準を掛けた値", () => {
  for (const hiW of [50, 70, 100, 120]) {
    const I = makeInput("tokuyou", { hiW });
    I.rows = I.rows.map(r => ({ ...r, hi: 1 }));
    const c = calcState(I);
    for (const r of c.rows) assert.ok(near(r.salaryHi, r.salarySe * hiW / 100), `hiW=${hiW} ${r.name}`);
  }
});

/* ---- 不変条件9: 賃金倍率を1に合わせたら配分後年収＝基準年収 ---- */
test("INV-09 入力どおりにすると賃金倍率が1.000になる", () => {
  for (const s of ALL) {
    for (const mode of ["ratio", "direct"]) {
      const I0 = makeInput(s, { mode, autoRev: mode === "ratio" });
      const c = calcState(fitWage(I0));
      assert.ok(near(c.k, 1, 1e-6), `${s} ${mode} k=${c.k}`);
      for (const r of c.rows) if (r.n > 0) assert.ok(near(r.salarySe, r.a, 1e-6), `${s} ${r.name}`);
    }
  }
});

/* ---- 不変条件10: 不足を埋めたら未達がゼロになる ---- */
test("INV-10 不足職種を埋めると未達が解消する", () => {
  for (const s of ALL) {
    for (const scale of [0.5, 1, 1.4]) {
      const I = makeInput(s, { scale, sizes: { ...makeInput(s).sizes } });
      // 規模を広げて基準だけ引き上げ、構成を意図的に不足させる
      const I2 = { ...I, sizes: { ...I.sizes, cap: (I.sizes.cap ?? 20) * 1.5 } };
      const c = calcState(fillStd(I2));
      assert.equal(c.shorts.length, 0, `${s} scale=${scale} 残:${c.shorts.map(x => x.name)}`);
    }
  }
});

/* ---- 不変条件11: 職種別基準を満たす最小合計 ≥ 基準の単純合計 ---- */
test("INV-11 構成を考慮した下限は基準の単純合計を下回らない", () => {
  for (const s of ALL) {
    for (const mul of [0.6, 1, 1.5, 2]) {
      const I = makeInput(s);
      I.rows = I.rows.map((r, i) => ({ ...r, n: r.n * (i % 2 ? mul : 1) }));
      const c = calcState(I);
      if (isFinite(c.nMinComp)) assert.ok(c.nMinComp >= c.stdN - 1e-9, `${s} mul=${mul}`);
    }
  }
});

/* ---- 不変条件12: 配置下限を満たすなら曲線の成立区間に入る ---- */
test("INV-12 成立判定と下限・上限の関係が整合する", () => {
  for (const s of ALL) {
    for (const atgt of [200, 400, 700, 1200]) {
      const c = run(s, { atgt });
      assert.equal(c.feasible, c.nmin <= c.nCap + 1e-9, `${s} atgt=${atgt}`);
      assert.equal(c.okA, c.avg >= atgt - 1e-9, `${s} atgt=${atgt}`);
    }
  }
});

/* ---- 不変条件13: 規模を変えると収益が連動する（自動計算時） ---- */
test("INV-13 自動計算時は規模と収益が連動する", () => {
  for (const s of ALL) {
    const a = run(s);
    const key = s === "tsuusho" ? "cap" : "cap";
    const I = makeInput(s);
    const b = calcState({ ...I, sizes: { ...I.sizes, [key]: I.sizes[key] * 2 } });
    assert.ok(b.rev > a.rev * 1.9, `${s} rev ${a.rev} -> ${b.rev}`);
    assert.ok(b.users > a.users * 1.9, s);
  }
});

/* ---- 不変条件14: 負の値・ゼロ入力で NaN を出さない ---- */
test("INV-14 極端な入力でも数値が壊れない", () => {
  const cases = [
    { ratio: 0 }, { fuku: 0 }, { bonus: 0 }, { hiW: 0 }, { atgt: 0 },
    { price: 0 }, { scale: 0.4 }, { sizes: { cap: 0, occ: 0 } }
  ];
  for (const s of ALL) {
    for (const over of cases) {
      const c = run(s, over);
      for (const [k, v] of Object.entries(c)) {
        if (typeof v === "number") assert.ok(!Number.isNaN(v), `${s} ${JSON.stringify(over)} ${k}=NaN`);
      }
      for (const r of c.rows) {
        for (const k of ["totalFte", "salarySe", "salaryHi", "monthlySe"]) {
          assert.ok(!Number.isNaN(r[k]), `${s} ${JSON.stringify(over)} ${r.name}.${k}=NaN`);
        }
      }
    }
  }
});
