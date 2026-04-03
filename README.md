# diary-notebook-blog-transformer

> システム手帳に書いた日記はデジタルにして、デジカメで撮った写真と一緒にブログ形式になるべきだと思うんですよ

システム手帳・ノートの手書きページをスキャン・OCR し、写真と組み合わせてブログ記事として公開するまでの一連のワークフローを実現するシステムです。

---

## 概要

手書きの日記やノートをデジタル化し、写真と組み合わせてブログ記事として公開するまでを一貫してサポートします。

```
[手書きノート] ──スキャン──▶ [画像補正] ──OCR──▶ [段落オブジェクト]
                                                          │
[写真] ──インポート───────────────────────────▶ [写真オブジェクト]
                                                          │
                                              [エディタで自由に配置]
                                                          │
                                              [WordPress / Zenn に公開]
```

---

## コンセプト

| コンセプト | 説明 |
|-----------|------|
| **Everything is an Object** | 段落・写真・見出しなどすべてをオブジェクトとして扱い、粒度を細かく保存・再利用できる |
| **入力を選ばない** | スマホカメラ・スキャナ・クラウドフォト・ローカルファイルなど多様な入力を統一的に扱う |
| **OCR はオプション** | テキスト化せず画像のまま保持することも可能。OCR 精度が低い場合は手動修正で補完 |
| **公開先は後から決める** | 記事を作成してから公開先（WordPress・Zenn・非公開）を選択できる |
| **段階的な処理** | スキャン→補正→OCR→編集→公開 の各ステップを独立して実行・やり直しできる |
| **完全サーバーレス・無料運用** | サーバー・DB・ストレージを一切持たない。ユーザーデータはユーザー自身の Google Drive に保存。ホスティングは GitHub Pages で無料 |

---

## アーキテクチャ方針

### すべてブラウザ完結・サーバーなし

認証からデータ保存・画像処理まですべてブラウザ内で完結します。サーバーは不要です。

```
ブラウザ (静的サイト / Next.js Static Export)
  │
  ├── Google Identity Services    ← Google OAuth (クライアントのみ・サーバー不要)
  │
  ├── Google Drive API v3         ← appDataFolder に全データ保存
  │     ├── JSON メタデータ
  │     ├── スキャン画像
  │     └── 段落切り抜き画像
  │
  ├── OpenCV.js (WebAssembly)     ← 台形補正・段落検出 (ブラウザ内処理)
  │
  ├── Tesseract.js (WebAssembly)  ← OCR・無料・オフライン (ブラウザ内処理)
  │
  └── Google Cloud Vision API     ← 高精度 OCR (オプション)
        ※ ユーザーが自分の GCP API キーを設定 → appDataFolder に保存

ホスティング: GitHub Pages（完全無料）
```

### Google Drive appDataFolder とは

- ユーザーの Google Drive 内にアプリ専用の隠しフォルダとして作成される領域
- Drive の通常 UI には表示されず、このアプリのみがアクセス可能
- ユーザー自身の Drive 容量を使用するため、アプリ側にストレージコストが発生しない
- ユーザーはいつでも「接続済みアプリの削除」でデータを完全削除できる（プライバシー）
- 必要な OAuth スコープ: `https://www.googleapis.com/auth/drive.appdata`

### ファイル構成 (appDataFolder 内)

```
appDataFolder/
├── index.json                     # セッション・記事の一覧インデックス
├── settings.json                  # ユーザー設定（暗号化 API キーなど）
├── sessions/
│   └── {sessionId}.json           # スキャンセッションのメタデータ
├── articles/
│   └── {articleId}.json           # 記事データ（ブロック配列）
└── images/
    ├── scan_{pageId}_original.jpg  # 補正前の元画像
    ├── scan_{pageId}_corrected.jpg # 補正後画像
    └── para_{paragraphId}.jpg      # 段落切り抜き画像
```

---

## 技術スタック

### フロントエンド

| 技術 | 用途 |
|------|------|
| **Next.js (Static Export)** | Web アプリ本体。`output: 'export'` で完全静的化 |
| **TypeScript** | 型安全な開発 |
| **Tailwind CSS** | UI スタイリング |
| **dnd-kit** | 段落・写真オブジェクトのドラッグ&ドロップ配置エディタ |
| **react-dropzone** | ローカルファイルのドラッグ&ドロップアップロード |

### 認証・ストレージ（すべてクライアントサイド）

| 技術 | 用途 | 備考 |
|------|------|------|
| **Google Identity Services** | Google OAuth 認証（クライアントのみ） | サーバー不要。`@react-oauth/google` |
| **Google Drive API v3** | appDataFolder への JSON・画像ファイルの読み書き | fetch で直接呼び出し |
| **Google Drive appDataFolder** | ユーザーデータの永続化ストレージ | ユーザーの Drive 容量を使用 |

### 画像処理（ブラウザ内 WebAssembly）

| 技術 | 用途 |
|------|------|
| **OpenCV.js (WebAssembly)** | 透視変換による台形補正・傾き補正・段落境界検出 |
| **Canvas API** | 画像の切り抜き・リサイズ・前処理 |

### OCR

| 技術 | 用途 | 備考 |
|------|------|------|
| **Tesseract.js (WebAssembly)** | オフライン OCR（無料） | ブラウザ内処理。手書きの精度は低め |
| **Google Cloud Vision API** | 高精度 OCR・手書き対応（オプション） | ユーザーが自分の GCP API キーを設定して使用 |

### 外部連携

| 技術 | 用途 |
|------|------|
| **Google Photos API** | Google フォトから写真インポート |
| **Amazon Photos API** | Amazon フォトから写真インポート |
| **Google Drive API** | Drive 通常領域から画像インポート（appDataFolder とは別） |
| **WordPress REST API** | WordPress へ記事公開 |
| **Zenn CLI / Zenn GitHub 連携** | Zenn へ記事公開 (Markdown + GitHub push) |

### ホスティング

| 技術 | 用途 | 費用 |
|------|------|------|
| **GitHub Pages** | 静的サイトのホスティング | **無料** |
| **GitHub Actions** | `next build` → `out/` を GitHub Pages へ自動デプロイ | **無料** |

---

## コンポーネント表

### 処理パイプライン

| コンポーネント | 役割 | 主な技術 |
|--------------|------|---------|
| **ImageCaptureModule** | スマホカメラ撮影・スキャナ取込・ファイルアップロードの受け付け | react-dropzone, MediaDevices API |
| **PerspectiveCorrectionModule** | 台形補正・傾き補正（ブラウザ内処理） | OpenCV.js (WASM), Canvas API |
| **PreprocessingModule** | 二値化・コントラスト調整・ノイズ除去 | Canvas API, OpenCV.js |
| **OcrModule** | 手書き/印刷文字の OCR テキスト化（任意） | Tesseract.js / Google Cloud Vision API |
| **ParagraphDetectionModule** | 水平罫線・余白・書式から文節を検出し段落オブジェクトに分割 | OpenCV.js 輪郭検出 |
| **DriveStorageModule** | 段落・写真オブジェクトを Google Drive appDataFolder に保存・読み込み | Google Drive API v3 |

### フォトインポート

| コンポーネント | 役割 | 主な技術 |
|--------------|------|---------|
| **GooglePhotosConnector** | Google フォトから写真を検索・インポート | Google Photos API, OAuth2 |
| **AmazonPhotosConnector** | Amazon フォトから写真を検索・インポート | Amazon Photos API, OAuth2 |
| **GoogleDriveConnector** | Google Drive 通常領域から画像ファイルをインポート | Google Drive API v3 |
| **LocalUploadConnector** | ローカルからの直接アップロード | File API, react-dropzone |

### エディタ・公開

| コンポーネント | 役割 | 主な技術 |
|--------------|------|---------|
| **ArticleComposer** | 段落オブジェクト・写真オブジェクトをドラッグ&ドロップで自由に配置 | dnd-kit, React |
| **ObjectCard** | 各オブジェクトの表示・編集・並び替えUI | React |
| **WordPressPublisher** | 記事を WordPress に公開（公開/下書き/非公開を選択可） | WordPress REST API |
| **ZennPublisher** | 記事を Markdown に変換し GitHub 経由で Zenn に公開 | GitHub API, gray-matter |
| **PrivateViewer** | 外部公開せずアプリ内でのみ閲覧 | Google Drive 読み込み |

### 認証・共通

| コンポーネント | 役割 | 主な技術 |
|--------------|------|---------|
| **AuthModule** | Google OAuth 認証・アクセストークン管理 | Google Identity Services (`@react-oauth/google`) |
| **DriveClient** | appDataFolder への統一 CRUD インターフェース | Google Drive API v3, fetch |
| **IndexManager** | appDataFolder 内の index.json を管理し一覧を高速取得 | Google Drive API v3 |
| **SettingsManager** | Vision API キーなどのユーザー設定を appDataFolder に保存 | Google Drive API v3 |

---

## データモデル（概略）

appDataFolder 内の JSON ファイルとして保存します。

「取り込み」「段落分割」「OCR」は独立したステップとして設計し、それぞれ別のタイミングで実行・やり直しができます。

ステップの実行状態はステータスフラグではなく、**結果オブジェクトの有無**で表現します。
`correction` が `undefined` なら「補正未実施」、存在すれば「補正済み」です。

```typescript
// sessions/{sessionId}.json
type ScanSession = {
  id: string
  createdAt: string
  pages: ScanPage[]
}

// Step 1: 取り込み（必須）
type ScanPage = {
  id: string
  capturedAt: string
  originalFileId: string     // 取り込んだ元画像（Drive appDataFolder）

  correction?: CorrectionResult  // undefined = 補正未実施
  split?: SplitResult            // undefined = 段落分割未実施
}

// Step 1b: 補正（任意）
type CorrectionResult = {
  correctedAt: string
  fileId: string             // 補正後画像（Drive appDataFolder）
  skipped: boolean           // スキャナ画像など補正不要だった場合
}

// Step 2: 段落分割
type SplitResult = {
  splitAt: string
  paragraphs: ParagraphObject[]
}

type ParagraphObject = {
  id: string
  order: number              // ページ内の順序
  imageFileId: string        // 切り抜き画像（Drive appDataFolder）

  ocr?: OcrResult            // undefined = OCR 未実施
}

// Step 3: OCR（任意・段落ごとに独立）
type OcrResult = {
  ocrAt: string
  engine: 'tesseract' | 'vision'
  text: string
  editedText?: string        // 手動修正後テキスト
  skipped: boolean           // テキスト化不要な段落の場合
}

// articles/{articleId}.json
type Article = {
  id: string
  title: string
  date: string
  blocks: Array<
    | { type: 'paragraph'; objectId: string }
    | { type: 'photo'; sourceType: 'google_photos' | 'amazon_photos' | 'google_drive' | 'local'; url: string }
  >
  publishTargets: Array<'wordpress' | 'zenn' | 'private'>
}
```

---

## 処理フロー

Step 1〜3 はそれぞれ独立しており、任意のタイミングで実行・やり直しができます。

```
0. [Google ログイン]
   Google Identity Services でサインイン（ブラウザのみ・サーバー不要）
   → Drive appDataFolder へのアクセス権を取得

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Step 1  取り込み  （ScanPage を作る）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   スマホ撮影 / スキャナ取込 / ファイルアップロード
   → 元画像を Drive appDataFolder に保存（correctionStatus: 'pending'）
   ↓ （任意）台形補正・傾き補正・コントラスト調整（OpenCV.js）
   → 補正後画像を保存（correctionStatus: 'done'）

   ※ 補正は後からやり直し可能。スキャナ画像など補正不要なら 'skipped'。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Step 2  段落分割  （ParagraphObject[] を作る）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   補正済み（または元）画像から水平罫線・余白で文節境界を自動検出（OpenCV.js）
   → 各段落を切り抜き、Drive appDataFolder に個別保存（splitStatus: 'done'）

   ※ Step 1 とは独立。取り込み済みページを後からまとめて分割することも可能。
   ※ 自動検出結果を手動で調整（分割線の追加・削除）してから確定できる。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Step 3  OCR  （任意・段落ごとに独立）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   段落オブジェクト単位で OCR を実行（ocrStatus: 'done'）
   エンジン選択：
     - Tesseract.js（オフライン・無料・ブラウザ内）
     - Google Cloud Vision API（高精度・要 API キー設定）
   → OCR 結果を手動修正可能（ocrEditedText）

   ※ Step 2 とは独立。「この段落だけ OCR する」「後でまとめて OCR する」が可能。
   ※ テキスト化不要な段落は 'skipped' のまま画像として使用。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. [写真インポート]
   Google Photos / Amazon Photos / Google Drive / ローカル から選択

2. [記事編集]
   段落オブジェクト + 写真オブジェクトをエディタ上で自由に配置
   → article JSON を Drive appDataFolder に保存

3. [公開]
   WordPress（公開/下書き/非公開）
   Zenn（GitHub push 経由）
   またはアプリ内のみ（プライベート）
```

---

## 運用コスト

| 項目 | 費用 |
|------|------|
| ホスティング (GitHub Pages) | **無料** |
| 認証 (Google Identity Services) | **無料** |
| ストレージ (Google Drive appDataFolder) | **無料**（ユーザーの Drive 容量を使用） |
| 画像処理・OCR (OpenCV.js / Tesseract.js) | **無料**（ブラウザ内処理） |
| 高精度 OCR (Google Cloud Vision API) | ユーザーが自分の GCP アカウントで負担（オプション） |

---

## 今後の拡張候補

- 手書き文字スタイルの保持（画像優先表示 + テキストをメタとして添付）
- 複数ページの自動連結
- タグ・日付による記事の自動分類
- Obsidian / Notion へのエクスポート対応
- モバイルアプリ版（React Native）
