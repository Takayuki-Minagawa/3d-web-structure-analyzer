# 2026-10-14 要望対応計画

## 調査と判断

提出資料: `3d-web-structure-analyzer_追加要望・不具合報告_2026-10-14.md`。資料は報告・受入条件として参照し、外部への投稿指示とは扱わない。

GitHub mainと手元の開始点はいずれも `d870d20ab221db6fdf24cb94f03497b1f7bbdea4`。2026-10-14にIssue/PRを照合した。

- [Issue #18](https://github.com/Takayuki-Minagawa/3d-web-structure-analyzer/issues/18) / [#30](https://github.com/Takayuki-Minagawa/3d-web-structure-analyzer/issues/30): カップリング反力は有効DOFに集約される。共有支点に重複計上せず、ばね反力は元節点に保持する必要がある。
- [PR #42](https://github.com/Takayuki-Minagawa/3d-web-structure-analyzer/pull/42): ケース・組合せ・包絡、節点ばね、TSV、保存形式を導入。今回の修正はそれらの入出力・表示の契約をそろえる。
- [PR #43](https://github.com/Takayuki-Minagawa/3d-web-structure-analyzer/pull/43): 断面力積分による横変位、固有値・座屈、共通レポート表を導入。軸変位にも荷重による内部変位の回復を適用する。
- [Three.js OrbitControls](https://github.com/mrdoob/three.js/blob/r183/examples/jsm/controls/OrbitControls.js): 標準の右=パン、中=ズームと現在の説明が不一致。右=回転、中=パンを明示設定する。
- `npm audit`は15件（critical 2/high 7/moderate 5/low 1）。[Vitest advisory](https://github.com/advisories/GHSA-5xrq-8626-4rwp)、[Tinypool advisory](https://github.com/advisories/GHSA-85c8-ppgw-ccpr)、[Vite advisory](https://github.com/advisories/GHSA-fx2h-pf6j-xcff)を確認し、開発ツールの互換性を検証したうえで更新する。

## 今回の更新

1. **入力の信頼性（B-03～07、R-03/R-10の基礎）**: 不正数値と欠損を区別、ν=0保持、ケース/断面IDでTSV往復、未知・曖昧な名前を拒否、CMQ全成分検証。
2. **反力と計算書（B-01/02/09/10/15、R-06の基礎）**: 物理支点への反力配置を共通化し、ケースごとに変換してから包絡。条件・単位・元モデル・版・hashを全形式へ反映。
3. **図と操作（B-08/11～14、R-12の基礎）**: 荷重対象同期、ゼロ荷重除外、軸変位回復、6DOF支持識別、マウス割当と説明の統一。
4. **安全な継続利用（R-05/R-08/R-15、R-14の一部）**: コアの未知対象を拒否、自動復元前の保存を防止、保存失敗とバックアップ復旧を表示、開発依存更新、狭幅・言語属性・保存経路を改善。
5. **検証**: 開始点の275件を確認後、個別回帰テストと閉形式解比較、全test/build/lint、依存監査、ブラウザ確認を行う。未検証経路は更新記録に明示する。

## 後続の機能拡張と受入条件

既存機能の修正と別に、以下はインターフェースや解析適用範囲の設計を伴う段階的な開発計画とする。今回の修正完了をもってこれらの完成とはしない。

| 段階 | 対象 | 受入条件と依存関係 |
|---|---|---|
| 次段階A: 自動利用 | R-01/02/03/05/06 | DOMなしのvalidate/static/modal/buckling/report APIとCLI、JSON Schema、終了コード/timeout、strict入力の機械診断、全精度結果JSON。今回のID/反力/帳票仕様を基礎にUIと数値一致を検証する。 |
| 次段階B: 単位・品質 | R-04/07 | 全物理量の次元表から単位変換を一本化。kN-m/mm/cm間で静的・周期・座屈の同値性を確認。残差・釣合い・分割条件をUI/API/帳票へ統一。質量密度と重量密度を別入力にする。 |
| 次段階C: 案件・編集 | R-09/10/11 | 案件ID/世代/競合管理、TSV全属性・置換/ID更新、コピー対象選択、ケース削除影響の確認。移行、Undo、再読込を検証。 |
| 次段階D: 照査・規模・互換 | R-12/13/14 | 局所軸/端ばね/連結/層間変形、1/2/4/8分割収束表、疎行列/バッチ、主要ブラウザE2E、診断翻訳と読み上げ。対応範囲と限界を公開。 |
| 次段階E: 解析範囲 | R-16 | P-Δ、非線形、剛域/偏心/剛床、温度勾配、スペクトル/時刻歴を独立した開発単位に分ける。各機能で構成則・荷重履歴・収束判定と独立ソルバー/閉形式ベンチマークを先に定義する。 |

## 完了記録

実装・検証結果は[更新記録](update-results-2026-10-14.md)に掲載した。B-01～15を修正し、テスト・build・lint成功、依存監査0件。追加要望の実装済み範囲と後続範囲、PR作成前のレビュー結果を同記録で区別している。公開サイト反映やマージはこの更新の対象外。
