# AGENTS.md — diary-notebook-blog-transformer

> **プロジェクトの仕様・設計方針・データモデルの詳細は [README.md](./README.md) を参照してください。**
> 仕様変更時は README.md のみを更新すれば済むように、本ファイルには開発運用上の情報のみを記載します。

## プロジェクト概要

システム手帳・ノートの手書きページをスキャン・OCR し、写真と組み合わせてブログ記事として公開するクライアントサイド Web アプリケーションです。完全サーバーレス・無料運用を前提としています。

詳細なコンセプト・アーキテクチャ・コンポーネント構成・データモデル・処理フローは **[README.md](./README.md)** を参照。

## 開発環境セットアップ

```bash
npm install
npm run dev       # 開発サーバー起動 (http://localhost:3000)
npm run build     # next build → Static Export (out/)
npm run lint      # eslint src/
```

## 技術スタック

- **Next.js 16** (`output: 'export'` で完全静的化)
- **TypeScript** (`strict: true`)
- **Tailwind CSS 4** (`@tailwindcss/postcss`)
- **dnd-kit** — ドラッグ&ドロップ
- **react-dropzone** — ファイルアップロード
- **@react-oauth/google** — Google OAuth (クライアントのみ)
- **Tesseract.js** — ブラウザ内 OCR (WebAssembly)
- **OpenCV.js** — 画像補正・段落検出 (WebAssembly) ※今後実装

## コーディング規約

### 全般
- **言語**: すべて日本語。コメント・UI テキスト・コードレビュー・PR コメントすべて日本語で記述する
- **パスエイリアス**: `@/*` → `./src/*` を使用（`import { useAuth } from "@/lib/auth-context"`）
- **"use client"**: Next.js Static Export でもブラウザ API を使用するコンポーネントには `"use client"` を明示

### TypeScript
- `strict: true` が有効
- 型は `src/types/` に定義し、`index.ts` からバレルエクスポート
- 型の JSDoc コメントは簡潔に日本語で

### コンポーネント
- 関数コンポーネント + Arrow Function（ページコンポーネントを除き）
- `src/components/` に配置
- UI は Tailwind CSS のクラスで直接記述

### ESLint
- `eslint-config-next/core-web-vitals` を使用
- `npm run lint` で `src/` を対象にチェック

## アーキテクチャ上の重要事項

以下の制約・設計方針は開発時に常に意識すること。詳細は [README.md](./README.md) を参照。

- **サーバーなし**: すべてブラウザ完結。API Routes や Server Components は使用しない（Static Export のため）
- **ストレージ**: Google Drive の手帳画像フォルダ（可視）と appDataFolder（非表示）の 2 層構造
- **非破壊処理**: 補正・段落分割は画像ファイルを生成せず、パラメータ・座標のみをメタデータに保存。表示時に Canvas で適用
- **ステップ独立性**: 取り込み → 補正 → 段落分割 → OCR の各ステップは独立し、任意の順序・タイミングで実行・やり直しが可能
- **ステータス表現**: ステータスフラグではなく、結果オブジェクトの有無（`undefined` ↔ 存在）で処理状態を表現
- **OAuth スコープ**: `drive.file`（可視フォルダ）+ `drive.appdata`（非表示フォルダ）

## 認証パターン

- `Providers.tsx` が `GoogleOAuthProvider` → `AuthProvider` の順でラップ
- `useAuth()` フックで `user`, `accessToken`, `isAuthenticated`, `login`, `logout` を取得
- アクセストークンは自動期限切れ管理（60 秒のバッファ付き）
- トークン失効時は自動的に `clearAuth()` が呼ばれる

## Next.js 設定

- `output: 'export'` — 静的エクスポート（GitHub Pages でホスティング）
- `images.unoptimized: true` — Static Export では必須
- `basePath` — `NEXT_PUBLIC_BASE_PATH` 環境変数で設定（GitHub Pages のサブディレクトリ対応）

## プルリクエストのレビューフロー

プルリク作成後は以下のサイクルで Copilot レビューを行い、すべての指摘が解消されるまで反復する。

1. Copilot をレビュアーにアサインする
   ```bash
   gh api repos/<owner>/<repo>/pulls/<pull_request_id>/requested_reviewers \
     -X POST -f reviewers[]=copilot-pull-request-reviewer[bot]
   ```
2. 3 分おきにレビュー完了をポーリングする（レビューは一度にすべて投稿されるため、完了検出後の追加待ちは不要）
3. レビュー完了後、各指摘に対して対応する（コード修正）または対応しない（Resolve / Dismiss）判断をする
4. すべての指摘を resolve したら、再度 Copilot をアサインし、ステップ 2 に戻る
5. 指摘がゼロになるか、すべての指摘が「対応しない」になったらサイクル終了
6. サイクル完了後、プルリクの状態を "Ready for review" に変更し、人間の確認可能な状態にする
