import { test } from "node:test";
import assert from "node:assert/strict";
import * as ENGINE from "../engine.mjs";
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

/* INV-13（自動計算時は規模と収益が連動）は STEP2 再設計で削除。収益は決算書からの実額入力に
   なり、規模には自動連動しない（規模変更時は収益も見直す、と画面で促す）。
   規模と利用者数の連動そのものは users=cap×occ/100 として INV-14/explore が触れる。 */

/* ---- 不変条件15（v0.5）: 人件費総額 ＝ 職員給与原資×(1+法定福利費率) ＋ 派遣費 ----
   v0.4 の「正規payroll＋非正規payroll＝給与原資」を v0.5 の派遣を含む恒等式に更新。
   金額を正規/非正規で分けない（§9）代わりに、職員給与原資（派遣・法定福利費を除く）に
   事業主負担を戻し派遣費を足すと人件費総額になる。 */
test("INV-15 人件費総額＝職員給与原資×(1+法定福利費率)＋派遣費", () => {
  for (const s of ALL) {
    for (const fuku of [0, 16.5, 19]) {
      for (const hakenFee of [0, 1200]) {
        const c = calcState(makeInput(s, { fuku, hakenFee }));
        assert.ok(near(c.pool * (1 + fuku / 100) + c.hakenFee, c.total, 1e-9),
          `${s} fuku=${fuku} 派遣費=${hakenFee}: ${c.pool*(1+fuku/100)+c.hakenFee} ≠ total ${c.total}`);
      }
    }
  }
});

/* ---- release-gate 指摘: 看護職員の段階配置は告示の境界（以下／超）で判定する ----
   特養・ユニット。告示は「30以下1／30超50以下2／50超130以下3／130超は50ごとに+1」。
   旧実装は u<30/u<50/u<=130 で、u=30・50 ちょうどで1段重く出ていた（指定権者の解釈と
   1人ずれる）。境界値 u=30/50/130 と、その直上を検証する。 */
test("KANGO-01 看護職員の段階配置は告示の境界で判定する", () => {
  const cases = [[30, 1], [31, 2], [50, 2], [51, 3], [130, 3], [131, 4]];
  for (const svc of ["tokuyou", "unit"]) {
    for (const [u, expected] of cases) {
      const c = calcState(makeInput(svc, { sizes: { cap: u, occ: 100 } }));
      const kango = c.rows.find(r => r.key === "kango");
      assert.equal(kango.std, expected, `${svc} u=${u}: 看護 std=${kango.std}（期待 ${expected}）`);
    }
  }
});

/* ---- 敵対的レビュー指摘①: 老健の管理栄養士は入所定員で判定する ----
   基準の文言は「入所定員100以上で1以上」。実利用者数 u（稼働率調整後）で
   判定していたため、定員100・稼働92%（u=92）で基準0.0になり、過少配置を
   助長していた。判定キーを sz.cap に変更した回帰テスト。
   v0.5: 栄養士は独立行を廃し「その他職員」行に集約した（§1）。栄養士の寄与は
   その他の std に含まれるため、その他の std を通して 定員判定を検証する。
   定員100 と 定員99 の差（＝栄養士1）と、定員100 で稼働を落としても
   その他 std が下がらない（実利用者では判定しない）ことを見る。 */
test("RKN-01 老健の管理栄養士は実利用者数でなく入所定員で判定する（その他行に集約）", () => {
  const other = c => c.rows.find(r => r.key === "other").std;
  const at100 = occ => other(run("roken", { sizes: { cap: 100, occ } }));
  // 定員100 では稼働を落としても栄養士は消えない（その他 std が一定）
  const base = at100(100);
  for (const occ of [80, 90, 92]) {
    assert.equal(at100(occ), base, `定員100・稼働${occ}%: その他 std=${at100(occ)}（定員100は栄養士を含み一定のはず=${base}）`);
  }
  // 定員99 では栄養士0 → その他が定員100 より1少ない（他の職種は u=99/100 で不変）
  const o99 = other(run("roken", { sizes: { cap: 99, occ: 100 } }));
  assert.ok(near(base - o99, 1, 1e-9), `その他 std 定員100=${base} − 定員99=${o99} は栄養士分の1のはず`);
});

/* ==== v0.5 段階1（入力構造）で追加する不変条件 ==== */

/* ---- INV-22 分子と分母の整合（§2・§4）----
   A（1人あたり給与費）は分子=人件費総額・分母=正規＋非正規＋派遣。
   B（職員1人あたり給与費）は分子=職員給与原資・分母=正規＋非正規（派遣を除く）。
   派遣がある構成で、A と B の分母・分子がそれぞれ揃っていることを検算する。 */
test("INV-22 A/B の分子と分母が揃っている（派遣ありでも）", () => {
  for (const s of ALL) {
    for (const hakenFee of [0, 800, 2400]) {
      // 派遣の人数を各行に入れて分母を動かす
      let I = makeInput(s, { hakenFee });
      I.rows = I.rows.map(r => ({ ...r, haken: (r.haken || 0) + 1 }));
      const c = calcState(I);
      const staffN = c.nSe + c.nHi;             // 正規＋非正規
      const allN = staffN + c.nHk;              // ＋派遣
      assert.ok(near(c.A, allN > 0 ? c.total / allN : 0, 1e-9),
        `${s} 派遣費=${hakenFee}: A=${c.A} ≠ total/(正規+非正規+派遣)=${c.total/allN}`);
      assert.ok(near(c.B, staffN > 0 ? c.pool / staffN : 0, 1e-9),
        `${s} 派遣費=${hakenFee}: B=${c.B} ≠ pool/(正規+非正規)=${c.pool/staffN}`);
    }
  }
});

/* ---- INV-23 派遣0のとき A ÷ B ＝ 1 + 法定福利費率（§4）----
   AとBは基準が違う（A=総額÷全員／B=原資÷職員）。派遣が0なら分母は一致し、
   分子の差は事業主負担だけになるので比は常に 1+法定福利費率 になる（一致はしない）。 */
test("INV-23 派遣0のとき A÷B = 1+法定福利費率", () => {
  for (const s of ALL) {
    for (const fuku of [0, 16.5, 19]) {
      const c = calcState(makeInput(s, { fuku, hakenFee: 0 }));
      assert.ok(c.nHk === 0, `${s}: 既定で派遣人数は0のはず（nHk=${c.nHk}）`);
      assert.ok(near(c.A / c.B, 1 + fuku / 100, 1e-9),
        `${s} fuku=${fuku}: A/B=${c.A/c.B} ≠ 1+法定福利費率=${1+fuku/100}`);
    }
  }
});

/* ---- INV-25 初期状態で 基準合計 ＝ 正規合計 が厳密に一致（§6）----
   v0.4 は基準を各行 CEIL してから正規に入れていたため、基準合計30.7に対し
   正規合計30.8と0.1ずれた。v0.5 は build 側で std を0.1丸めし、初期正規は
   その std をそのまま入れる（CEILしない）ので厳密一致する。 */
test("INV-25 初期状態で 基準合計 = 正規合計（厳密）", () => {
  for (const s of ALL) {
    const c = calcState(makeInput(s));
    const stdSum = c.rows.reduce((a, r) => a + r.std, 0);
    const regSum = c.rows.reduce((a, r) => a + r.n, 0);
    assert.ok(near(stdSum, regSum, 1e-12), `${s}: 基準合計=${stdSum} ≠ 正規合計=${regSum}`);
    assert.equal(c.nHi, 0, `${s}: 初期の非正規は0のはず（nHi=${c.nHi}）`);
    assert.equal(c.nHk, 0, `${s}: 初期の派遣は0のはず（nHk=${c.nHk}）`);
  }
});

/* ==== v0.5 段階2（配置比率軸）で追加する不変条件 ==== */

/* ---- INV-27 配置比率 ＝ 入所者数 ÷（介護＋看護の合計）（§3）----
   calcState の ratioActual が users/coreN で、coreN が核職種（介護・看護）の
   常勤換算合計（正規＋非正規＋派遣）であること。さらに、比率を目標Rへ畳む変換
   scaleCoreToRatio が実際にその比率を達成することを検算する。 */
test("INV-27 配置比率 = 入所者数 ÷（介護＋看護の合計）", () => {
  for (const s of ALL) {
    // ランダムに核・その他を混ぜても、比率＝users/coreN が定義どおり成立する
    for (const mul of [0.6, 1, 1.7]) {
      let I = makeInput(s, { scale: mul });
      I.rows = I.rows.map(r => ({ ...r, hi: (r.hi || 0) + 1, haken: (r.haken || 0) + 0.5 }));
      const c = calcState(I);
      const roles = c.svc.ratio ? c.svc.ratio.roles : [];
      const coreFte = c.rows.filter(r => roles.includes(r.key)).reduce((a, r) => a + r.totalFte, 0);
      assert.ok(near(c.coreN, coreFte, 1e-9), `${s}: coreN=${c.coreN} ≠ 核totalFte合計=${coreFte}`);
      if (coreFte > 0) assert.ok(near(c.ratioActual, c.users / c.coreN, 1e-9),
        `${s}: 配置比率=${c.ratioActual} ≠ users/coreN=${c.users / c.coreN}`);
    }
    // 目標比率Rへ核だけ按分 → 変換後の users/coreN が R に一致する
    const base = makeInput(s);
    const roles = SERVICES[s].ratio ? SERVICES[s].ratio.roles : [];
    for (const R of [1.0, 2.0, 3.0, 4.0]) {
      const c0 = calcState(base);
      const newRows = ENGINE.scaleCoreToRatio(base.rows, roles, c0.users, R);
      const c1 = calcState({ ...base, rows: newRows });
      if (c1.coreN > 0) assert.ok(near(c1.users / c1.coreN, R, 1e-9),
        `${s} R=${R}: 変換後 users/coreN=${c1.users / c1.coreN} ≠ ${R}`);
    }
  }
});

/* ---- INV-24 配置比率のドラッグでは その他職員 の人数が変わらない（§3）----
   scaleCoreToRatio は核職種（介護・看護）だけを按分し、その他職員（施設長・医師・
   相談員・機能訓練・介護支援専門員・管理栄養士の集約行）は動かさない。 */
test("INV-24 配置比率ドラッグでその他職員の人数は不変", () => {
  for (const s of ALL) {
    const base = makeInput(s);
    const roles = SERVICES[s].ratio ? SERVICES[s].ratio.roles : [];
    const other0 = base.rows.filter(r => !roles.includes(r.key));
    for (const R of [1.0, 2.5, 4.0]) {
      const c0 = calcState(base);
      const newRows = ENGINE.scaleCoreToRatio(base.rows, roles, c0.users, R);
      const other1 = newRows.filter(r => !roles.includes(r.key));
      assert.equal(other1.length, other0.length, `${s}: その他行数が変わった`);
      other0.forEach((r0, i) => {
        const r1 = other1.find(x => x.key === r0.key);
        assert.ok(r1, `${s}: その他行 ${r0.key} が消えた`);
        assert.ok(near(r1.n, r0.n, 1e-12) && near(r1.hi, r0.hi, 1e-12) && near(r1.haken, r0.haken, 1e-12),
          `${s} R=${R}: その他行 ${r0.key} の人数が変わった（n ${r0.n}→${r1.n} / hi ${r0.hi}→${r1.hi} / haken ${r0.haken}→${r1.haken}）`);
      });
    }
  }
});

/* ---- STEP2 再設計: 人件費率は入力ではなく total/rev の出力である ----
   収益と人件費総額を独立に入力し、率が割り算で出ること。収益0で NaN/Infinity を出さないこと。
   （旧設計は率が入力で effRatio が入力をそのまま返す循環になっていた） */
test("STEP2-01 人件費率 = 人件費総額 ÷ 収益（出力）", () => {
  for (const s of ALL) {
    for (const rev of [1000, 37000, 90000]) {
      for (const total of [500, 23791, 60000]) {
        const c = calcState(makeInput(s, { rev, total }));
        assert.ok(near(c.effRatio, total / rev * 100), `${s} rev=${rev} total=${total}: effRatio=${c.effRatio}`);
      }
    }
  }
});

test("STEP2-02 収益0でも人件費率・単価が NaN/Infinity にならない", () => {
  for (const s of ALL) {
    const c = calcState(makeInput(s, { rev: 0, total: 23791 }));
    assert.ok(Number.isFinite(c.effRatio) && c.effRatio === 0, `${s}: effRatio=${c.effRatio}`);
    assert.ok(Number.isFinite(c.unitRev) && c.unitRev === 0, `${s}: unitRev=${c.unitRev}`);
    for (const [k, v] of Object.entries(c)) if (typeof v === "number") assert.ok(!Number.isNaN(v), `${s} ${k}=NaN`);
  }
});

/* ---- 不変条件18（v0.4新機能A）: 必要人件費率の符号と成立判定が一致 ----
   gapPt = needRatio - effRatio。rev>0・atgt>0 のとき gapPt<=0 ⇔ feasible。
   effRatio は total/rev で決まるので、total を振って人件費率を変える。 */
test("INV-18 gapPt<=0 と feasible が一致（rev>0・atgt>0）", () => {
  for (const s of ALL) {
    for (const atgt of [200, 400, 700]) {
      for (const total of [12000, 23791, 40000]) {
        const c = calcState(makeInput(s, { atgt, total }));
        if (c.rev > 0 && atgt > 0) {
          assert.equal(c.gapPt <= 1e-9, c.feasible,
            `${s} atgt=${atgt} total=${total}: gapPt=${c.gapPt} feasible=${c.feasible}`);
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
