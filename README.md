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
| **サーバーレス・ゼロ管理** | アプリ側にDBもストレージも持たない。ユーザーデータはユーザー自身の Google Drive に保存する |

---

## アーキテクチャ方針

### サーバー側にデータを持たない

本システムは **Google ログイン必須** とし、すべてのユーザーデータを **ユーザー自身の Google Drive appDataFolder** に保存します。

```
┌─────────────────────────────────────────────────────┐
│  ブラウザ (Next.js クライアント)                        │
│                                                       │
│  ┌──────────────┐    ┌──────────────────────────┐   │
│  │  画像処理     │    │  Google Drive appDataFolder│   │
│  │  OpenCV.js   │◀──▶│  (ユーザー自身の Drive)    │   │
│  │  (WASM)      │    │  ・JSON メタデータファイル  │   │
│  └──────────────┘    │  ・スキャン画像ファイル     │   │
│                       │  ・段落切り抜き画像        │   │
│  ┌──────────────┐    └──────────────────────────┘   │
│  │  OCR         │                                     │
│  │  Tesseract.js│    ┌──────────────────────────┐   │
│  │  (WASM)      │    │  Google Cloud Vision API  │   │
│  │  または      │◀──▶│  (高精度 OCR / オプション) │   │
│  │  Vision API  │    └──────────────────────────┘   │
│  └──────────────┘                                     │
└─────────────────────────────────────────────────────┘
         ▲
         │ Serverless Edge Functions (Next.js / Vercel)
         │ ・Google OAuth トークン交換
         │ ・Vision API プロキシ（API キー隠蔽）
         ▼
┌──────────────────────────────────────────────────────┐
│  外部公開先                                            │
│  WordPress REST API  /  Zenn (GitHub push)            │
└──────────────────────────────────────────────────────┘
```

### Google Drive appDataFolder とは

- ユーザーの Google Drive 内にアプリ専用の隠しフォルダとして作成される領域
- Drive の通常フォルダには表示されず、このアプリのみがアクセス可能
- ユーザー自身の Drive 容量を使用するため、アプリ側にストレージコストが発生しない
- ユーザーはいつでも「接続済みアプリの削除」でデータを完全削除できる（プライバシー）
- 必要な OAuth スコープ: `https://www.googleapis.com/auth/drive.appdata`

### ファイル構成 (appDataFolder 内)

```
appDataFolder/
├── index.json                    # セッション・記事の一覧インデックス
├── sessions/
│   └── {sessionId}.json          # スキャンセッションのメタデータ
├── articles/
│   └── {articleId}.json          # 記事データ（ブロック配列）
└── images/
    ├── scan_{pageId}_original.jpg # 補正前の元画像
    ├── scan_{pageId}_corrected.jpg# 補正後画像
    └── para_{paragraphId}.jpg     # 段落切り抜き画像
```

---

## 技術スタック

### フロントエンド

| 技術 | 用途 |
|------|------|
| **Next.js (App Router)** | Web アプリ本体。Static Export + Edge Functions で完全サーバーレス |
| **TypeScript** | 型安全な開発 |
| **Tailwind CSS** | UI スタイリング |
| **dnd-kit** | 段落・写真オブジェクトのドラッグ&ドロップ配置エディタ |
| **react-dropzone** | ローカルファイルのドラッグ&ドロップアップロード |

### 認証・ストレージ

| 技術 | 用途 | 備考 |
|------|------|------|
| **NextAuth.js (Google Provider)** | Google OAuth 認証（必須） | access_token を Drive API に使用 |
| **Google Drive API v3** | appDataFolder への JSON・画像ファイルの読み書き | サーバー側DBの代替 |
| **Google Drive appDataFolder** | ユーザーデータの永続化ストレージ | ユーザーの Drive 容量を使用 |

### 画像処理（クライアントサイド）

| 技術 | 用途 | 備考 |
|------|------|------|
| **OpenCV.js (WebAssembly)** | 透視変換による台形補正・傾き補正 | ブラウザ内で処理。サーバー不要 |
| **Canvas API** | 画像の切り抜き・リサイズ・前処理 | ネイティブブラウザ API |

### OCR

| 技術 | 用途 | 備考 |
|------|------|------|
| **Tesseract.js (WebAssembly)** | オフライン OCR（無料） | ブラウザ内で処理。手書きの精度は低め |
| **Google Cloud Vision API** | 高精度 OCR・手書き対応（オプション） | Edge Function 経由でプロキシ。有料 |

### 外部連携

| 技術 | 用途 |
|------|------|
| **Google Photos API** | Google フォトから写真インポート |
| **Amazon Photos API** | Amazon フォトから写真インポート |
| **Google Drive API** | Drive 通常領域から画像インポート（appDataFolder とは別） |
| **WordPress REST API** | WordPress へ記事公開 |
| **Zenn CLI / Zenn GitHub 連携** | Zenn へ記事公開 (Markdown + GitHub push) |

### デプロイ

| 技術 | 用途 |
|------|------|
| **Vercel** | Next.js のホスティング。Edge Functions でトークン交換・API プロキシ |

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
| **PrivateViewer** | 外部公開せずアプリ内でのみ閲覧 | Next.js + Google Drive 読み込み |

### 認証・共通

| コンポーネント | 役割 | 主な技術 |
|--------------|------|---------|
| **AuthModule** | Google OAuth 認証・トークン管理 | NextAuth.js (Google Provider) |
| **DriveClient** | appDataFolder への統一 CRUD インターフェース | Google Drive API v3, fetch |
| **VisionApiProxy** | API キーを隠蔽しつつ Vision API を呼び出す | Next.js Edge Function |
| **IndexManager** | appDataFolder 内の index.json を管理し一覧を高速取得 | Google Drive API v3 |

---

## データモデル（概略）

appDataFolder 内の JSON ファイルとして保存します。

```typescript
// sessions/{sessionId}.json
type ScanSession = {
  id: string
  createdAt: string
  pages: ScanPage[]
}

type ScanPage = {
  id: string
  originalFileId: string    // Drive appDataFolder 内のファイル ID
  correctedFileId: string
  paragraphs: ParagraphObject[]
}

type ParagraphObject = {
  id: string
  imageFileId: string       // Drive appDataFolder 内の切り抜き画像 ID
  ocrText?: string          // OCR テキスト（任意）
  ocrEditedText?: string    // 手動修正後テキスト
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

```
1. [Google ログイン]
   Google OAuth でサインイン
   → Drive appDataFolder へのアクセス権を取得

2. [スキャン入力]
   スマホ撮影 or スキャナ取込 or ファイルアップロード

3. [画像補正]（ブラウザ内 / OpenCV.js）
   台形補正 → 傾き補正 → 二値化・コントラスト調整
   → 補正後画像を Drive appDataFolder に保存

4. [段落検出]（ブラウザ内 / OpenCV.js）
   水平罫線・余白・書式から文節境界を自動検出
   → 各段落を切り抜き、Drive appDataFolder に個別保存

5. [OCR]（任意）
   Tesseract.js（オフライン）または Google Cloud Vision API（高精度）で OCR
   → 結果をメタデータ JSON に書き込み

6. [写真インポート]
   Google Photos / Amazon Photos / Google Drive / ローカル から選択

7. [記事編集]
   段落オブジェクト + 写真オブジェクトをエディタ上で自由に配置
   → article JSON を Drive appDataFolder に保存

8. [公開]
   WordPress（公開/下書き/非公開）
   Zenn（GitHub push 経由）
   またはアプリ内のみ（プライベート）
```

---

## 今後の拡張候補

- 手書き文字スタイルの保持（画像優先表示 + テキストをメタとして添付）
- 複数ページの自動連結
- タグ・日付による記事の自動分類
- Obsidian / Notion へのエクスポート対応
- モバイルアプリ版（React Native）
