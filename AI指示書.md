# 2Dフレーム解析WEBアプリ AI指示書

## 0. この文書の使い方
この文書は、**ブラウザのみで動作する 2D フレーム解析 WEB アプリ**を AI に実装させるための指示書である。  
要件定義、アーキテクチャ、解析仕様、描画仕様、性能要件、実装順序、受け入れ条件までを含む。  

ユーザー要件中の「部材貸し」は **「部材荷重」** の意味として扱う。

---

## 1. AI への役割指示
あなたは、**構造解析・数値計算・TypeScript フロントエンド・高速描画・ブラウザ最適化**に強いシニアエンジニア AI です。  
以下の制約を守って、実装しやすく、保守しやすく、かつ高速に動作する 2D フレーム解析アプリを設計・実装してください。

### 絶対条件
- **サーバーアプリは使わない。**
- **ブラウザのみで完結する SPA とする。**
- **JavaScript 系技術で実装する。TypeScript を必須とする。**
- **解析コアは UI から分離する。**
- **重い解析処理はメインスレッドをブロックしない。**
- **数値計算は `Float64Array` を基本に実装する。**
- **モデル構築、確認、解析、結果表示まで一貫して行えること。**
- **変位図、モーメント図、軸力図、せん断力図を表示できること。**
- **荷重は以下を最低限サポートすること。**
  - 節点荷重: `Fx`, `Fy`, `Mz`
  - 部材荷重: 集中荷重、等分布荷重
- **線形弾性・微小変形の 2D フレーム解析を対象とする。**
- **まずは MVP を確実に完成させ、拡張可能な設計にする。**

### 禁止事項
- SSR / BFF / API サーバー前提の設計
- 解析ロジックを React コンポーネント内部に埋め込むこと
- 大量の object を毎フレーム生成して GC 負荷を上げること
- 毎回フル再描画が必要な DOM/SVG 主体設計を中心にすること
- 外部数値計算ライブラリに過度に依存し、内部挙動が追えなくなること
- `any` 多用、暗黙の型変換、多層の密結合

---

## 2. プロダクトの目的
ブラウザ上で 2D フレームモデルを作成し、支持条件・断面性能・荷重を設定して、解析後に以下を確認できるアプリを作る。

### 必須アウトプット
1. モデル図
2. 支持条件
3. 荷重図
4. 変形図（変位図）
5. 軸力図
6. せん断力図
7. 曲げモーメント図
8. 数値結果テーブル（節点変位、部材端力、反力）

---

## 3. スコープ定義

## 3.1 MVP に含めるもの
- 節点の作成・移動・削除
- 部材の作成・削除
- 節点拘束の設定
- 材料・断面特性の設定
- 節点荷重 `Fx`, `Fy`, `Mz`
- 部材荷重
  - 集中荷重
  - 等分布荷重
- 解析実行
- 解析エラー表示
- 変形図表示
- 軸力図 / せん断力図 / モーメント図表示
- 節点変位、反力、部材端力の表表示
- JSON 形式の保存 / 読み込み
- オートセーブ

## 3.2 できれば入れたいもの
- グリッド表示、スナップ
- 部材番号 / 節点番号表示
- 部材ローカル軸表示
- Undo / Redo
- サンプルモデル読み込み
- PNG エクスポート
- 結果スケール調整
- 最大値 / 最小値ラベル表示

## 3.3 初期版では対象外にしてよいもの
- 幾何学的非線形
- 材料非線形
- 座屈解析
- 動的解析
- 温度荷重
- 支点沈下
- 部材端剛域
- 部材端リリース
- 部分分布荷重
- 台形分布荷重
- 面内以外の 3D 効果

> ただし、将来拡張しやすいデータ構造にはしておくこと。

---

## 4. 推奨技術スタック

### 必須方針
- 言語: **TypeScript**
- ビルド: **Vite**
- UI: **React**
- 状態管理: **Zustand** もしくは同等の軽量ストア
- 描画: **PixiJS** を第一候補
- 解析: **純粋 TypeScript の自前実装**
- 非同期処理: **Web Worker**
- 永続化: **IndexedDB**
- テスト: **Vitest** + **Playwright**

### 採用理由
- UI は React で部品分割しやすく、フォーム・パネル・表・モーダルを整理しやすい。
- 描画は PixiJS で GPU 利用を前提に高速化しやすい。
- 解析は純粋 TypeScript に分離することで、Worker 化・単体テスト・将来の WASM 化がしやすい。
- 永続化は IndexedDB によってサーバー不要で大きめの構造化データを保持できる。
- Vite により静的ホスティング前提の開発・ビルド・Worker 同梱が容易。

### 実装上の原則
- React は **UI 管理専用** とし、キャンバス描画は imperative に行う。
- 解析計算は `src/core/analysis` に閉じ込める。
- Worker と main thread 間は **最小限のデータ** だけを送る。
- 大きな配列は transfer を活用してコピーコストを抑える。

---

## 5. UI / UX 要件

## 5.1 画面レイアウト
- 左: ツールバー
- 中央: モデル / 結果表示キャンバス
- 右: プロパティインスペクタ
- 下部または右下: 解析結果タブ

## 5.2 ツールバー機能
- 選択
- 節点作成
- 部材作成
- 支持条件設定
- 節点荷重設定
- 部材荷重設定
- 解析実行
- 表示切替
  - モデル
  - 荷重
  - 変形図
  - 軸力図
  - せん断力図
  - モーメント図

## 5.3 編集操作
- クリックで節点作成
- 2 点指定で部材作成
- 既存節点へのスナップ
- 節点ドラッグで座標変更
- 複数選択
- Delete キー削除
- 右パネルで数値直接編集
- ズーム、パン
- Undo / Redo（できれば）

## 5.4 確認表示
- 節点番号の ON/OFF
- 部材番号の ON/OFF
- 支持記号の表示
- 荷重矢印表示
- ローカル軸表示
- 断面属性ラベル表示
- エラー箇所の強調表示

## 5.5 結果表示
- 変形図は未変形図に重ねて表示
- 変形倍率を変更可能にする
- 軸力図 / せん断力図 / モーメント図の倍率変更
- 部材クリックで詳細数値を表示
- 節点クリックで変位と反力を表示
- 最大値・最小値にラベル表示（できれば）

---

## 6. モデル定義

## 6.1 座標系
- グローバル座標系: `X` 右正、`Y` 上正、`Rz` 反時計回り正
- 各部材のローカル座標系:
  - `x_local`: i 端 → j 端
  - `y_local`: `x_local` を反時計回りに 90° 回転した向き

## 6.2 自由度
各節点は 3 自由度を持つ。
- `ux`
- `uy`
- `rz`

節点自由度順は必ず以下に固定すること。

```text
[node0_ux, node0_uy, node0_rz, node1_ux, node1_uy, node1_rz, ...]
```

## 6.3 データ構造

```ts
export type NodeId = string;
export type MemberId = string;
export type MaterialId = string;
export type SectionId = string;

export interface Node {
  id: NodeId;
  x: number;
  y: number;
  restraint: {
    ux: boolean;
    uy: boolean;
    rz: boolean;
  };
}

export interface Material {
  id: MaterialId;
  name: string;
  E: number;
}

export interface Section {
  id: SectionId;
  name: string;
  A: number;
  I: number;
}

export interface Member {
  id: MemberId;
  ni: NodeId;
  nj: NodeId;
  materialId: MaterialId;
  sectionId: SectionId;
}

export interface NodalLoad {
  id: string;
  nodeId: NodeId;
  fx: number;
  fy: number;
  mz: number;
}

export type MemberLoadDirection = 'localX' | 'localY';

export interface PointMemberLoad {
  id: string;
  memberId: MemberId;
  type: 'point';
  direction: MemberLoadDirection;
  value: number;
  a: number; // i端からの距離
}

export interface UniformMemberLoad {
  id: string;
  memberId: MemberId;
  type: 'udl';
  direction: MemberLoadDirection;
  value: number; // 単位長さ当たり
}

export type MemberLoad = PointMemberLoad | UniformMemberLoad;

export interface ProjectModel {
  nodes: Node[];
  materials: Material[];
  sections: Section[];
  members: Member[];
  nodalLoads: NodalLoad[];
  memberLoads: MemberLoad[];
  units: {
    force: string;
    length: string;
    moment: string;
  };
}
```

### 方針
- 内部計算は単位系に依存しない数値として扱う。
- 表示単位は `units` で管理する。
- ID は UUID か短い一意文字列にする。
- 節点参照は index 固定ではなく ID ベースで持ち、解析前に index 化する。

---

## 7. 解析仕様

## 7.1 解析理論
- 2D フレーム要素
- 線形弾性
- 微小変形
- Euler-Bernoulli 梁理論ベース
- 軸変形 + 曲げ変形を考慮
- せん断変形は初期版では無視してよい

## 7.2 要素自由度
1 要素 6 自由度。

```text
[uix, uiy, rzi, ujx, ujy, rzj]
```

## 7.3 要素剛性マトリクス（ローカル）
部材長を `L`、ヤング係数を `E`、断面積を `A`、断面二次モーメントを `I` とする。

```text
k_local =
[ EA/L      0           0        -EA/L      0            0      ]
[ 0      12EI/L^3    6EI/L^2      0     -12EI/L^3    6EI/L^2   ]
[ 0       6EI/L^2     4EI/L       0      -6EI/L^2     2EI/L    ]
[ -EA/L     0           0         EA/L      0            0      ]
[ 0     -12EI/L^3   -6EI/L^2      0      12EI/L^3   -6EI/L^2   ]
[ 0       6EI/L^2     2EI/L       0      -6EI/L^2     4EI/L    ]
```

## 7.4 座標変換
方向余弦:

```text
c = (xj - xi) / L
s = (yj - yi) / L
```

変換行列 `T` を用いて、

```text
k_global_element = T^T * k_local * T
```

とする。

## 7.5 荷重ベクトル
### 節点荷重
節点荷重は全体荷重ベクトル `F` に直接加える。

### 部材荷重
部材荷重は **等価節点荷重（consistent load vector）** に変換して全体系へ組み込む。

### 実装方針
閉形式をベタ書きしてもよいが、将来拡張を考えると **形状関数ベース** で実装すること。

#### 軸方向補間
```text
N_axial(ξ) = [1 - ξ, ξ]
```

#### 曲げ方向補間（Hermite）
`ξ = x / L`

```text
N_bend(ξ) = [
  1 - 3ξ^2 + 2ξ^3,
  L(ξ - 2ξ^2 + ξ^3),
  3ξ^2 - 2ξ^3,
  L(-ξ^2 + ξ^3)
]
```

### 具体的な考え方
- `localX` の分布荷重 `qx(x)` は `N_axial` を使って等価節点化する。
- `localY` の分布荷重 `qy(x)` は `N_bend` を使って等価節点化する。
- 集中荷重は作用位置 `a` における形状関数評価で節点力へ落とし込む。
- 等分布荷重は積分で節点力へ落とし込む。

### 推奨実装
- `point load`: 解析的評価
- `udl`: 解析解または数値積分
- 実装ミス防止のため、単体テストで基準解を必ず用意すること

## 7.6 全体方程式
```text
K d = F
```

- `K`: 全体剛性マトリクス
- `d`: 節点変位ベクトル
- `F`: 全体荷重ベクトル

拘束条件を反映して自由自由度系に縮約し、連立方程式を解く。

## 7.7 反力
全変位 `d` を復元後、

```text
R = K_full * d - F_full
```

で反力を求める。

## 7.8 部材端力
各部材について、

```text
d_local = T * d_element_global
q_end_local = k_local * d_local - f_member_load_local
```

として部材端力を求める。

## 7.9 断面力図の生成
各部材を複数点サンプリングして以下を描画する。
- 軸力 `N(x)`
- せん断力 `V(x)`
- 曲げモーメント `M(x)`
- 変位 `u(x), v(x)`

### 断面力計算方針
- ローカル座標系で評価する。
- 部材端力と部材荷重から区間内平衡で求める。
- 集中荷重がある場合は不連続点を境に区間分割する。
- 等分布荷重がある場合は `V(x)` が一次、`M(x)` が二次になることを反映する。

### サンプリング規則
- 通常は 41〜81 点程度
- 集中荷重位置、端部、最大値候補位置は必ず含める
- 荷重の切り替わり点をノードに追加して折れ線化する

## 7.10 符号規約
符号は自由に決めてよいが、**必ず全アプリで統一すること**。
少なくとも以下を満たすこと。
- 軸力の正は引張
- 節点自由度の正方向は UI と解析で一致
- 部材荷重の向き表示と数値符号が一致
- 断面力図の正負が凡例に明示される

> モーメント図の正負は実装者が定義してよいが、ツールチップ・表・図で一致させること。

## 7.11 数値安定性と異常検知
必ず以下をチェックすること。
- ゼロ長部材
- 材料未設定
- 断面未設定
- `A <= 0`, `I <= 0`, `E <= 0`
- 孤立節点
- 拘束不足による特異行列
- 節点参照切れ
- 荷重位置が `0 <= a <= L` を外れる入力

エラー時は「何が」「どこで」「どう直すか」がわかる文言を出すこと。

---

## 8. ソルバー実装方針

## 8.1 基本方針
初期版では以下の優先順位で実装する。

1. **信頼性**
2. **保守性**
3. **速度**

### 推奨
- 全体剛性は対称行列として扱う
- 自由自由度だけを取り出して縮約する
- `Float64Array` ベースで保持する
- まずは dense LDLᵀ / Cholesky 系で確実に動かす
- 次段階で skyline / banded 化できるよう API を分離する

## 8.2 実装レイヤ
```text
Model -> Indexing -> Element Matrices -> Assembly -> Constraint Reduction -> Solve -> Recover -> PostProcess
```

## 8.3 望ましい API
```ts
export interface AnalysisInput {
  model: IndexedModel;
}

export interface AnalysisOutput {
  displacements: Float64Array;
  reactions: Float64Array;
  elementEndForces: Map<MemberId, Float64Array>;
  diagrams: Map<MemberId, DiagramSeries>;
  warnings: string[];
}

export function analyzeFrame(input: AnalysisInput): AnalysisOutput;
```

## 8.4 将来拡張を見据えた分離
- `solverDense.ts`
- `solverSkyline.ts`
- `assembly.ts`
- `loads.ts`
- `recover.ts`
- `validation.ts`

この分離により、将来的に WASM や高速ソルバー差し替えを可能にする。

---

## 9. パフォーマンス要件

## 9.1 基本方針
- 解析は **Web Worker** で実行
- 描画は **React 再描画** に依存しない
- 数値配列は **TypedArray** を使う
- 大きなデータ受け渡しは **transferable** を優先
- 描画用ジオメトリはキャッシュする
- ドラッグ中の解析はデバウンスする
- マウス移動ごとに重い再計算をしない

## 9.2 Worker 利用ルール
- main thread は UI 応答専用
- worker は解析専用
- モデル変更時に即解析しない
- `Run` 明示実行 + 必要に応じて auto solve オプション
- Worker 返却値はシリアライズしやすい構造にする

## 9.3 レンダリング最適化
- モデル線、荷重、結果図をレイヤ分離する
- 変更のないレイヤは再生成しない
- ラベルはズーム閾値で間引く
- クリック判定用の簡易ヒット領域を持つ
- 描画はポリライン化して使い回す

## 9.4 目標性能
以下は目標値であり、受け入れ基準として扱う。
- 100 節点 / 150 部材程度で編集が快適
- 300 自由度程度の解析が体感即時
- 1000 自由度規模でも UI が固まらない
- パン / ズーム中に著しいカクつきがない

---

## 10. 永続化とファイル

## 10.1 保存
- IndexedDB にオートセーブ
- 最新プロジェクトを復元可能
- JSON エクスポート / インポート対応

## 10.2 JSON 方針
- バージョン番号を持つ
- 将来拡張用に `schemaVersion` を入れる
- 互換性のない変更時は migrate 関数を用意する

```ts
export interface ProjectFile {
  schemaVersion: number;
  savedAt: string;
  model: ProjectModel;
}
```

---

## 11. 推奨ディレクトリ構成

```text
src/
  app/
    App.tsx
    routes/
    providers/
  ui/
    panels/
    dialogs/
    toolbar/
    tables/
  state/
    projectStore.ts
    viewStore.ts
    selectionStore.ts
  rendering/
    canvasApp.ts
    layers/
    hitTest/
    symbols/
  core/
    model/
      types.ts
      indexing.ts
      validation.ts
    analysis/
      element2dFrame.ts
      transforms.ts
      loads.ts
      assembly.ts
      constraints.ts
      solverDense.ts
      recover.ts
      diagrams.ts
      analyzeFrame.ts
  worker/
    analysis.worker.ts
    protocol.ts
  persistence/
    indexedDb.ts
    projectFile.ts
  examples/
    cantilever.json
    portal-frame.json
  tests/
    unit/
    integration/
    e2e/
```

---

## 12. 実装ルール

## 12.1 TypeScript ルール
- `strict: true`
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`
- `any` 禁止
- 解析コアはクラスより純関数中心

## 12.2 数値計算ルール
- `number` は全て倍精度として扱う
- 表示時のみ丸める
- 内部計算で丸めない
- 許容誤差を定義する

### 推奨誤差
- 変位 / 反力 / 断面力の検証: `1e-6` 相対誤差基準
- 特異判定: ピボットしきい値を定義

## 12.3 UI ルール
- 右パネル編集は入力中に破壊的更新しすぎない
- 数値入力は空文字と 0 を区別
- 不正値は即座に赤表示
- 解析結果が古い場合は「未更新」表示を出す

## 12.4 エラー表示ルール
- 単なる `failed` を出さない
- 例: 「部材 M12 の長さが 0 です。節点座標を確認してください」
- 例: 「拘束不足のため解析できません。少なくとも剛体変位を拘束してください」

---

## 13. テスト要件

## 13.1 単体テスト
最低限、以下をテストすること。
- 要素長と方向余弦
- ローカル剛性マトリクス
- 座標変換
- 全体組立
- 拘束縮約
- 節点荷重組み込み
- 部材集中荷重の等価節点化
- 部材等分布荷重の等価節点化
- 反力計算
- 断面力復元

## 13.2 基準問題
以下の既知問題を必ず通すこと。

### ケース 1: 片持ち梁 + 先端集中荷重
- 変位、固定端モーメント、せん断力が理論値と一致すること

### ケース 2: 片持ち梁 + 等分布荷重
- 固定端モーメント、先端たわみが理論値と一致すること

### ケース 3: 両端固定梁 + 等分布荷重
- 固定端モーメント分布が妥当であること

### ケース 4: 単純な門形ラーメン
- 左右対称荷重で対称変形になること

### ケース 5: 軸力支配部材
- 軸方向変位が `FL/EA` に一致すること

## 13.3 E2E テスト
- モデル作成
- 荷重設定
- 解析実行
- 結果タブ確認
- JSON 保存 / 復元

---

## 14. 受け入れ条件
以下を全て満たしたら初版完成とする。

### 機能
- 節点 / 部材 / 支持 / 荷重を作成できる
- 解析できる
- 変形図・軸力図・せん断力図・モーメント図が表示できる
- 節点変位・反力・部材端力が表で見られる
- JSON 保存 / 読込ができる

### 品質
- 明らかな特異モデルで適切なエラーが出る
- 基準問題のテストが通る
- 解析中に UI が固まらない
- 部材数が増えても編集体験が大きく悪化しない

### コード品質
- 解析コアが UI から分離されている
- Worker 化されている
- テストが整備されている
- 型が十分に付いている

---

## 15. 実装フェーズ

## Phase 1: 土台作成
- Vite + React + TypeScript
- Zustand
- PixiJS キャンバス
- IndexedDB 基盤
- Worker 通信基盤

## Phase 2: モデル編集
- 節点・部材・支持作成
- 選択・移動・削除
- グリッド / スナップ
- プロパティ編集

## Phase 3: 解析コア
- 要素剛性
- 座標変換
- 荷重組み込み
- 拘束縮約
- 線形ソルバー
- 反力 / 部材端力

## Phase 4: 結果可視化
- 変形図
- 軸力図
- せん断力図
- モーメント図
- 数値表

## Phase 5: 安定化
- テスト追加
- パフォーマンス改善
- オートセーブ
- サンプルモデル
- エラーメッセージ改善

---

## 16. AI への具体的な作業指示
以下の順で作業すること。

1. 型定義を先に確定する  
2. 解析コアを UI から独立して実装する  
3. 片持ち梁の単体テストを最初に通す  
4. その後 UI から解析コアを呼ぶ  
5. Worker 化する  
6. 描画を最適化する  
7. 最後に UX を磨く  

### 実装時の優先順位
- まず正しい解析
- 次に壊れにくい構成
- 次に高速化
- 最後に装飾

### 重要
- 荷重の符号と図の向きは最初に定義して固定すること
- 断面力図は符号規約がぶれやすいため、必ず基準テストを先に作ること
- 解析中でも UI が操作できる状態を保つこと
- 解析結果はモデル変更後に「古い結果」と明示すること

---

## 17. 追加の設計メモ

### 17.1 React と描画の分離
- React は設定 UI、表、ボタン、ダイアログのみ担当
- PixiJS はモデル線、荷重、変形図、断面力図の描画担当
- React state の更新で毎回キャンバス全再構築しないこと

### 17.2 データ変換の最適化
- `ProjectModel` は人間編集向け
- `IndexedModel` は解析向け
- 解析前に一度だけ index 化し、部材ごとの幾何情報も前計算する

### 17.3 オートセーブ
- モデル変更後 500〜1000ms デバウンスで保存
- 解析結果は別保存にしてもよい
- 壊れた JSON の読み込みエラーに備えること

### 17.4 将来拡張
将来的に以下を追加しやすい設計にする。
- 部材端リリース
- 台形荷重
- 部分分布荷重
- 支点沈下
- 温度荷重
- 3D フレーム
- WASM ソルバー

---

## 18. 最終成果物の条件
AI は最終的に次を出力すること。
- 実行可能なフロントエンドプロジェクト
- 主要なソースコード
- 単体テスト
- E2E テスト
- サンプルモデル JSON
- README

README には以下を含めること。
- セットアップ方法
- 起動方法
- ビルド方法
- 対応機能
- 制約事項
- 符号規約
- 既知の未対応項目

---

## 19. 公式情報ベースの技術選定メモ（参考）
以下は実装判断の参考。必要に応じて参照すること。

- Vite は高速な開発サーバーと静的サイト向けビルドを提供する。  
  https://vite.dev/guide/  
  https://vite.dev/guide/static-deploy

- React はコンポーネントベースで UI を組み立てやすい。  
  https://react.dev/

- TypeScript は日常的な JavaScript 開発に対して型安全性を提供する。  
  https://www.typescriptlang.org/docs/handbook/

- PixiJS は 2D 高性能レンダリング向けで、Graphics や GPU アクセラレーションを活用できる。  
  https://pixijs.com/  
  https://pixijs.com/8.x/guides/getting-started/intro  
  https://pixijs.com/8.x/guides/components/renderers  
  https://pixijs.com/8.x/guides/components/scene-objects/graphics

- Web Workers は UI スレッドを塞がずに重い処理を分離できる。  
  https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API

- OffscreenCanvas はワーカー側レンダリングや DOM 分離に役立つ。  
  https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas

- IndexedDB はブラウザ内で大量の構造化データを扱える。  
  https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API

- Vitest は Vite ベースのテストに相性がよい。  
  https://vitest.dev/

- Playwright はモダン Web アプリの E2E テストに適している。  
  https://playwright.dev/

---

## 20. 一文で要約した実装方針
**「UI は React、描画は PixiJS、解析は純 TypeScript を Worker で回し、TypedArray と consistent load vector により、サーバー不要で高速な 2D フレーム解析 WEB アプリを作る」**
