import { test } from "node:test";
import assert from "node:assert/strict";
import { SERVICES, initialRows, calcState } from "../engine.mjs";
import { makeInput } from "./helpers.mjs";

/* adversarial-review モード2で両モデルが挙げた矛盾の回帰テスト。
   場面12（老健・起動直後）で「職種別の基準を下回っています／介護職員：0.0 人 不足」と
   表示される一方、内訳は基準21.9に対し配置21.9で、判定文（不足）と数値（0.0）が矛盾していた。
   根因: initialRows が基準を 0.1 単位で四捨五入し、基準未満に丸め込む職種があった
   （老健 介護 std=21.905 → 21.9 に切り下げ）。基準どおりの初期配置は各職種で基準以上に
   なるべきで、そのとき職種別不足も配置下限超過も出てはならない。 */

test("INIT-01 起動直後の基準どおり配置は全職種で基準を満たす", () => {
  for (const s of Object.keys(SERVICES)) {
    const c = calcState(makeInput(s)); // makeInput は initialRows を使う＝起動直後の状態
    // 職種別に基準未満がないこと（表示精度 0.1 で見える不足も含めて許さない）
    for (const r of c.rows) {
      if (r.std > 0) {
        assert.ok(
          r.totalFte >= r.std - 1e-9,
          `${s} ${r.name}: 配置${r.totalFte.toFixed(4)} < 基準${r.std.toFixed(4)}`
        );
      }
    }
    // 職種別不足の判定が立たないこと（「0.0 人 不足」のような矛盾表示を防ぐ）
    assert.equal(c.shorts.length, 0, `${s} 起動直後に職種別不足: ${JSON.stringify(c.shorts)}`);
    assert.equal(c.blocked, null, `${s} 起動直後に blocked=${c.blocked}`);
  }
});

test("INIT-02 起動直後は配置下限を自動値が下回らない（成立判定の幻の未達を防ぐ）", () => {
  for (const s of Object.keys(SERVICES)) {
    const c = calcState(makeInput(s));
    // 自動追従の配置下限 nmin に対し、実配置 n が丸めで下回らないこと
    assert.ok(
      c.okN,
      `${s} 起動直後に「人数が下限を下回る」判定: n=${c.n.toFixed(4)} < nmin=${c.nmin.toFixed(4)}`
    );
  }
});
