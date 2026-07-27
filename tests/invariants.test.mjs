import { test } from "node:test";
import assert from "node:assert/strict";
import { SERVICES, calcState } from "../engine.mjs";
import { makeInput, run, near, fillStd } from "./helpers.mjs";

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

/* INV-08（非正規年収＝正規年収×水準・職種別）と INV-09（賃金倍率1.000）は
   v0.4 で職種別基準年収と賃金倍率 k を廃止したため削除。
   非正規平均＝正規平均×水準は INV-16 が、payroll 保存は INV-15 が担保する。 */

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

/* ---- 不変条件15（v0.4新式）: 正規payroll＋非正規payroll＝給与原資 ---- */
test("INV-15 正規payroll＋非正規payroll＝給与原資（恒等式）", () => {
  for (const s of ALL) {
    for (const hw of [0, 0.5, 0.7, 1.3]) {
      for (const scale of [0.7, 1, 1.3]) {
        const I = makeInput(s, { hiW: hw * 100, scale });
        I.rows = I.rows.map(r => ({ ...r, hi: r.n * 0.4, n: r.n * 0.6 }));
        const c = calcState(I);
        assert.ok(near(c.nSe * c.avgSe + c.nHi * c.avgHi, c.pool, 1e-9),
          `${s} hw=${hw} scale=${scale}: ${c.nSe*c.avgSe + c.nHi*c.avgHi} ≠ pool ${c.pool}`);
      }
    }
  }
});

/* ---- 不変条件16（v0.4新式）: 非正規平均＝正規平均×賃金水準 ----
   v0.3 は職種別基準年収で加重していたため、非正規が特定職種に偏る（非一様な）
   混在では成り立たなかった。v0.4 は基準年収を廃し avgSe=pool/(nSe+hw*nHi),
   avgHi=avgSe*hw に統一するので、偏った配置でも常に成立する。
   ※ 非正規を偶数行だけに寄せた「非一様」構成でテストする（一様配分だと旧式でも
     偶然一致してしまい、退行を捕らえられないため）。 */
test("INV-16 非正規平均は正規平均×賃金水準（新式・偏った混在でも成立）", () => {
  for (const s of ALL) {
    for (const hw of [0, 0.5, 0.7, 1.0, 1.3]) {
      for (const scale of [1, 1.3]) {
        const I = makeInput(s, { hiW: hw * 100, scale });
        I.rows = I.rows.map((r, i) => (i % 2 === 0) ? { ...r, hi: r.n * 0.6, n: r.n * 0.4 } : { ...r });
        const c = calcState(I);
        if (c.nHi > 0) assert.ok(near(c.avgHi, c.avgSe * hw, 1e-9),
          `${s} hw=${hw} scale=${scale}: avgHi=${c.avgHi} ≠ avgSe*hw=${c.avgSe*hw}`);
      }
    }
  }
});

/* ---- 敵対的レビュー指摘①: 老健の管理栄養士は入所定員で判定する ----
   基準の文言は「入所定員100以上で1以上」。実利用者数 u（稼働率調整後）で
   判定していたため、定員100・稼働92%（u=92）で基準0.0になり、過少配置を
   助長していた。判定キーを sz.cap に変更した回帰テスト。 */
test("RKN-01 老健の管理栄養士は実利用者数でなく入所定員で判定する", () => {
  for (const occ of [80, 90, 92, 100]) {
    const c = run("roken", { sizes: { cap: 100, occ } });
    const eiyou = c.rows.find(r => r.key === "eiyou");
    assert.ok(eiyou.std >= 1, `定員100・稼働${occ}%: 栄養士 std=${eiyou.std}（1以上のはず）`);
  }
  const c99 = run("roken", { sizes: { cap: 99, occ: 100 } });
  const e99 = c99.rows.find(r => r.key === "eiyou");
  assert.equal(e99.std, 0, `定員99: 栄養士 std=${e99.std}（0のはず）`);
});

/* ---- 不変条件18（v0.4新機能A）: 必要人件費率の符号と成立判定が一致 ----
   gapPt = needRatio - effRatio。rev>0・atgt>0 のとき gapPt<=0 ⇔ feasible。 */
test("INV-18 gapPt<=0 と feasible が一致（rev>0・atgt>0）", () => {
  for (const s of ALL) {
    for (const atgt of [200, 400, 700]) {
      for (const ratio of [40, 64.3, 90]) {
        const c = calcState(makeInput(s, { atgt, ratio }));
        if (c.rev > 0 && atgt > 0) {
          assert.equal(c.gapPt <= 1e-9, c.feasible,
            `${s} atgt=${atgt} ratio=${ratio}: gapPt=${c.gapPt} feasible=${c.feasible}`);
        }
      }
    }
  }
});

/* ---- 不変条件19（v0.4新機能C）: 年上昇率0なら推移は定点と一致 ---- */
test("INV-19 年上昇率0なら全年次で人件費率が定点と一致", () => {
  for (const s of ALL) {
    const c = calcState(makeInput(s, { g: 0 }));
    for (const x of c.proj.horizons) {
      assert.ok(near(x.ratio, c.effRatio), `${s} t=${x.t}: ${x.ratio} ≠ ${c.effRatio}`);
      assert.ok(near(x.delta, 0), `${s} t=${x.t} delta=${x.delta}`);
    }
  }
});

/* ---- 不変条件20（v0.4新機能C）: 推移の吸収3択が同じ増分を指す ----
   注意（設計で一度誤った点）: 人数削減に掛ける単価は t 年後の1人あたり人件費。 */
test("INV-20 推移の吸収（人員減・収入増）が同じ増分を指す", () => {
  for (const s of ALL) {
    for (const g of [1.5, 3, 5]) {
      const c = calcState(makeInput(s, { g }));
      const a = c.proj.absorb, f = Math.pow(1 + g / 100, a.t);
      const delta = c.total * (f - 1);
      assert.ok(near(a.delta, delta), `${s} g=${g} delta`);
      if (c.n > 0) {
        const unitAtT = (c.total / c.n) * f;   // 現在ではなく t 年後の単価
        assert.ok(near(a.cutN * unitAtT, delta, 1e-6), `${s} g=${g} 人員減ルート`);
      }
      if (c.rev > 0) assert.ok(near(a.revUp * (c.effRatio / 100), delta, 1e-6), `${s} g=${g} 収入増ルート`);
    }
  }
});

/* ---- 不変条件21（v0.4）: 職種別人数と規模を固定すれば他の入力で nMinComp は不変 ---- */
test("INV-21 職種別人数と規模を固定すれば nMinComp は不変", () => {
  for (const s of ALL) {
    const base = makeInput(s);
    const ref = calcState(base).nMinComp;
    if (!isFinite(ref)) continue;
    for (const over of [{ g: 5 }, { atgt: 800 }, { fuku: 25 }, { hiW: 120 }, { bonus: 6 }, { ratio: 90 }, { rev: 99999 }, { scale: 1.4 }]) {
      const c = calcState({ ...base, ...over });
      assert.ok(near(c.nMinComp, ref), `${s} ${JSON.stringify(over)}: ${c.nMinComp} ≠ ${ref}`);
    }
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
