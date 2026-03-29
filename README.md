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

---

## 技術スタック

### フロントエンド

| 技術 | 用途 |
|------|------|
| **Next.js (App Router)** | Web アプリ本体。SSR + API Routes を一体化 |
| **TypeScript** | 型安全な開発 |
| **Tailwind CSS** | UI スタイリング |
| **dnd-kit** | 段落・写真オブジェクトのドラッグ&ドロップ配置エディタ |
| **react-dropzone** | ローカルファイルのドラッグ&ドロップアップロード |

### バックエンド

| 技術 | 用途 |
|------|------|
| **Next.js API Routes / FastAPI (Python)** | API サーバ。画像処理が重い場合は Python サービスを分離 |
| **PostgreSQL** | オブジェクト・記事・メタデータの永続化 |
| **Prisma** | ORM |
| **Redis** | 非同期ジョブキュー (OCR・補正処理) |
| **BullMQ** | ジョブキュー管理 |
| **MinIO / AWS S3** | 画像ファイルのオブジェクトストレージ |

### 画像処理

| 技術 | 用途 |
|------|------|
| **OpenCV (Python)** | 透視変換による形状補正・台形補正 |
| **Pillow** | 画像リサイズ・前処理 |
| **scikit-image** | 二値化・ノイズ除去などの前処理 |

### OCR

| 技術 | 用途 | 備考 |
|------|------|------|
| **Google Cloud Vision API** | 印刷文字・手書き文字 OCR | 精度が高い。有料 |
| **Tesseract (tesserocr)** | オフライン OCR | 無料。手書きの精度は低め |
| **Azure AI Document Intelligence** | 手書き日本語に強い OCR | 代替オプション |

### 外部連携

| 技術 | 用途 |
|------|------|
| **Google Photos API** | Google フォトから写真インポート |
| **Amazon Photos API** | Amazon フォトから写真インポート |
| **Google Drive API** | Google Drive から画像インポート |
| **WordPress REST API** | WordPress へ記事公開 |
| **Zenn CLI / Zenn GitHub 連携** | Zenn へ記事公開 (Markdown + GitHub push) |
| **NextAuth.js** | OAuth 認証 (Google・Amazon アカウント) |

---

## コンポーネント表

### 処理パイプライン

| コンポーネント | 役割 | 主な技術 |
|--------------|------|---------|
| **ImageCaptureModule** | スマホカメラ撮影・スキャナ取込・ファイルアップロードの受け付け | react-dropzone, Web Camera API |
| **PerspectiveCorrectionModule** | 台形補正・傾き補正・トリミング | OpenCV (Python マイクロサービス) |
| **PreprocessingModule** | 二値化・コントラスト調整・ノイズ除去 | Pillow, scikit-image |
| **OcrModule** | 手書き/印刷文字の OCR テキスト化（任意） | Google Cloud Vision API / Tesseract |
| **ParagraphDetectionModule** | 水平線・余白・書式から文節を検出し段落オブジェクトに分割 | OpenCV 輪郭検出, ヒューリスティクス |
| **ObjectStorageModule** | 段落オブジェクト・写真オブジェクトの保存・バージョン管理 | PostgreSQL + S3/MinIO |

### フォトインポート

| コンポーネント | 役割 | 主な技術 |
|--------------|------|---------|
| **GooglePhotosConnector** | Google フォトから写真を検索・インポート | Google Photos API, OAuth2 |
| **AmazonPhotosConnector** | Amazon フォトから写真を検索・インポート | Amazon Photos API, OAuth2 |
| **GoogleDriveConnector** | Google Drive から画像ファイルをインポート | Google Drive API, OAuth2 |
| **LocalUploadConnector** | ローカルからの直接アップロード | Multipart form upload |

### エディタ・公開

| コンポーネント | 役割 | 主な技術 |
|--------------|------|---------|
| **ArticleComposer** | 段落オブジェクト・写真オブジェクトをドラッグ&ドロップで自由に配置 | dnd-kit, React |
| **ObjectCard** | 各オブジェクトの表示・編集・並び替えUI | React |
| **WordPressPublisher** | 記事を WordPress に公開（公開/下書き/非公開を選択可） | WordPress REST API |
| **ZennPublisher** | 記事を Markdown に変換し GitHub 経由で Zenn に公開 | GitHub API, gray-matter |
| **PrivateViewer** | 外部公開せずシステム内でのみ閲覧 | Next.js 内部ルート + 認証 |

### インフラ・共通

| コンポーネント | 役割 | 主な技術 |
|--------------|------|---------|
| **JobQueue** | OCR・画像補正の非同期処理キュー | BullMQ + Redis |
| **AuthModule** | ユーザー認証・クラウドサービス OAuth 連携 | NextAuth.js |
| **StorageAdapter** | S3/MinIO/ローカルを統一インターフェースで操作 | AWS SDK v3 |
| **DatabaseSchema** | オブジェクト・記事・接続設定の永続化 | Prisma + PostgreSQL |

---

## データモデル（概略）

```
ScanSession          // スキャンセッション
  └── ScanPage[]     // スキャンした1ページ
        └── ParagraphObject[]  // 検出された段落オブジェクト
              ├── imageUrl     // 元画像の切り抜き
              └── ocrText?     // OCR テキスト（任意）

PhotoObject          // インポートされた写真オブジェクト
  ├── sourceType     // google_photos | amazon_photos | google_drive | local
  └── imageUrl

Article              // 公開記事
  ├── blocks[]       // ParagraphObject | PhotoObject の順序付きリスト
  └── publishTargets[]  // wordpress | zenn | private
```

---

## 処理フロー

```
1. [スキャン入力]
   スマホ撮影 or スキャナ取込 or ファイルアップロード

2. [画像補正]
   台形補正 → 傾き補正 → 二値化・コントラスト調整

3. [段落検出]
   水平罫線・余白・書式から文節境界を自動検出
   → 各段落を個別オブジェクトとして切り抜き保存

4. [OCR]（任意）
   各段落オブジェクトに対して OCR 実行
   → 結果を手動修正可能

5. [写真インポート]
   Google Photos / Amazon Photos / Google Drive / ローカル から選択

6. [記事編集]
   段落オブジェクト + 写真オブジェクトをエディタ上で自由に配置

7. [公開]
   WordPress（公開/下書き/非公開）
   Zenn（GitHub push 経由）
   またはシステム内のみ（プライベート）
```

---

## 今後の拡張候補

- 手書き文字スタイルの保持（画像優先表示 + テキストをメタとして添付）
- 複数ページの自動連結
- タグ・日付による記事の自動分類
- Obsidian / Notion へのエクスポート対応
- モバイルアプリ版（React Native）
