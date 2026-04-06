# 1. OBJECTIVE

Issue #13 に従い、Google Drive の appDataFolder 上の `index.json` を管理する IndexManager、`settings.json` を管理する SettingsManager、初回起動時に Google Picker API を使ってユーザーが可視フォルダを選択できる初期化処理を実装する。これらは既存の DriveClient (Issue #12 済) を利用して appDataFolder への CRUD を行う。

# 2. CONTEXT SUMMARY

## 既存のコードベース

- **DriveClient** (`src/lib/drive-client.ts`): Google Drive API v3 のラッパークラス。`createAppDataFile`, `getAppDataFileByName`, `updateFileContent`, `findOrCreateFolder` 等を提供済み。`getAppDataFileByName` は `{ ...content, _fileId, _file }` を返す。
- **型定義** (`src/types/settings.ts`): `Settings`, `IndexSessionEntry`, `IndexPhotoEntry`, `IndexArticleEntry`, `AppIndex` が既に定義済み。バレルエクスポートは `src/types/index.ts` 経由。
- **エラー型** (`src/lib/drive-errors.ts`): `DriveNotFoundError` 等のエラークラス群。
- **認証** (`src/lib/auth-context.tsx`): `useAuth()` で `accessToken` を取得可能。現在のスコープは `drive.file` + `drive.appdata`。Google Picker API でフォルダ一覧を表示するため、`drive.readonly` を追加する必要がある。

## appDataFolder のファイル構成

```
appDataFolder/
├── index.json      ← IndexManager が管理
└── settings.json   ← SettingsManager が管理
```

`index.json` は `AppIndex` 型（sessions / photos / articles の配列）、`settings.json` は `Settings` 型（visionApiKey / notebookImageFolderId / notebookImageFolderName）。

## 制約

- すべてクライアントサイド完結（Static Export）
- DriveClient はコンストラクタで accessToken を受け取る設計
- 並行書き込み対策が必要（Issue の受け入れ条件）
- Google Picker API は外部スクリプト（`apis.google.com/js/api.js`）の動的読み込みが必要

# 3. APPROACH OVERVIEW

### IndexManager / SettingsManager（変更なし）

2 つのマネージャクラスをそれぞれ独立したファイルに実装する。共通パターン:

1. **コンストラクタ**: DriveClient を受け取る
2. **load() メソッド**: appDataFolder から対象 JSON を読み込み（存在しなければデフォルト値で作成）、インメモリにキャッシュ + `_fileId` を保持
3. **変異メソッド**: インメモリ状態を変更し、即座に appDataFolder に永続化
4. **並行書き込み対策**: **last-write-wins** + `version` カウンターによる競合検知（console.warn ログ出力）。シングルユーザーブラウザアプリのため厳密な楽観的ロックは過剰。

### 初期化処理（Google Picker API 使用）

初期化は UI を伴うため、純粋な関数ではなくコンポーネントベースで実装する:

1. **Google Picker のロード**: `useGooglePicker` フックで `apis.google.com/js/api.js` を動的読み込み
2. **フォルダ選択ダイアログ**: `FolderPickerDialog` コンポーネントで Picker を表示し、ユーザーにフォルダの選択（または新規作成）を促す
3. **初期化オーケストレーション**: `useInitializeApp` フックで SettingsManager をロードし、初期化が必要か判定。必要な場合はダイアログを表示し、選択されたフォルダを settings に保存

### OAuth スコープの追加

Google Picker API でフォルダ一覧を表示するには、現在の `drive.file` + `drive.appdata` に加えて `drive.readonly` スコープを追加する。

### 新規・変更ファイル

**新規:**
- `src/lib/index-manager.ts` — IndexManager クラス
- `src/lib/settings-manager.ts` — SettingsManager クラス
- `src/lib/use-google-picker.ts` — Google Picker API のロード・Picker 表示を行う React フック
- `src/components/folder-picker-dialog.tsx` — フォルダ選択ダイアログコンポーネント
- `src/lib/use-initialize-app.ts` — 初期化オーケストレーションフック

**変更:**
- `src/types/settings.ts` — `version` フィールド追加
- `src/lib/auth-context.tsx` — OAuth スコープに `drive.readonly` を追加

# 4. IMPLEMENTATION STEPS

## Step 1: 型の拡張 (`src/types/settings.ts`)

**目標**: 並行書き込み検知用の `version` フィールドを Settings と AppIndex の型に追加する。

**方法**:
- `Settings` 型に `version?: number` を追加
- `AppIndex` 型に `version?: number` を追加

**参照ファイル**: `src/types/settings.ts`

## Step 2: OAuth スコープの追加 (`src/lib/auth-context.tsx`)

**目標**: Google Picker API でユーザーのフォルダ一覧を表示するために `drive.readonly` スコープを追加する。

**方法**:
- `useGoogleLogin` の `scope` プロパティに `https://www.googleapis.com/auth/drive.readonly` を追加
- 追加後のスコープ: `openid email profile drive.file drive.appdata drive.readonly`

**参照ファイル**: `src/lib/auth-context.tsx`（`scope` プロパティ部分）

## Step 3: SettingsManager の実装 (`src/lib/settings-manager.ts`)

**目標**: `settings.json` の読込・書込・個別設定の更新を行うクラスを実装する。

**方法**:
- `SettingsManager` クラスを定義。コンストラクタで `DriveClient` を受け取る。
- 内部状態として `settings: Settings | null` と `_fileId: string | null` を保持。
- `load(): Promise<Settings>` メソッド:
  - `DriveClient.getAppDataFileByName("settings.json")` を呼び出す
  - 成功時: 返り値から `_fileId` を保存し、残りのフィールドを `settings` にキャッシュして返す。`version` があれば `_version` に記録
  - `DriveNotFoundError` 時: デフォルト値 `{ version: 1 }` で `createAppDataFile("settings.json", ...)` し、`_fileId` を保存して返す
- `private persist(): Promise<void>` メソッド:
  - `_version` をインクリメントして `{ ...settings, version: this._version }` として永続化
  - `_fileId` があれば `updateFileContent`、なければ `createAppDataFile` を使用
- 個別設定の getter/setter メソッド:
  - `getVisionApiKey(): string | undefined`
  - `setVisionApiKey(key: string | undefined): Promise<void>`
  - `getNotebookImageFolderId(): string | undefined`
  - `setNotebookImageFolderId(id: string | undefined): Promise<void>`
  - `getNotebookImageFolderName(): string | undefined`
  - `setNotebookImageFolderName(name: string | undefined): Promise<void>`
  - `getAll(): Settings`
  - `update(partial: Partial<Settings>): Promise<void>` — 複数設定を一度に更新

**参照ファイル**: `src/types/settings.ts`, `src/lib/drive-client.ts`, `src/lib/drive-errors.ts`

## Step 4: IndexManager の実装 (`src/lib/index-manager.ts`)

**目標**: `index.json` の読込・書込、およびセッション/写真/記事エントリの追加・削除を行うクラスを実装する。

**方法**:
- `IndexManager` クラスを定義。コンストラクタで `DriveClient` を受け取る。
- 内部状態として `index: AppIndex | null` と `_fileId: string | null` を保持。
- `load(): Promise<AppIndex>` メソッド:
  - `DriveClient.getAppDataFileByName("index.json")` を呼び出す
  - 成功時: `_fileId` を保存し、内容をキャッシュ（`version` 記録）
  - `DriveNotFoundError` 時: デフォルト `{ sessions: [], photos: [], articles: [], version: 1 }` でファイル作成
- `private persist(): Promise<void>` メソッド:
  - `_version` をインクリメントして永続化（SettingsManager と同様）
- エントリ管理メソッド:
  - **セッション**:
    - `addSession(entry: IndexSessionEntry): Promise<void>` — `sessions` に追加
    - `removeSession(id: string): Promise<void>` — `sessions` から該当 ID を削除
  - **写真**:
    - `addPhoto(entry: IndexPhotoEntry): Promise<void>` — `photos` に追加
    - `removePhoto(id: string): Promise<void>` — `photos` から該当 ID を削除
  - **記事**:
    - `addArticle(entry: IndexArticleEntry): Promise<void>` — `articles` に追加
    - `removeArticle(id: string): Promise<void>` — `articles` から該当 ID を削除
  - **全件取得**:
    - `getAll(): AppIndex`
    - `getSessions(): IndexSessionEntry[]`
    - `getPhotos(): IndexPhotoEntry[]`
    - `getArticles(): IndexArticleEntry[]`

**参照ファイル**: `src/types/settings.ts` (AppIndex 等の型), `src/lib/drive-client.ts`

## Step 5: Google Picker フックの実装 (`src/lib/use-google-picker.ts`)

**目標**: Google Picker API を動的ロードし、フォルダ選択ダイアログを表示する React フックを実装する。

**方法**:
- `useGooglePicker()` カスタムフック:
  - `apis.google.com/js/api.js` を `<script>` タグで動的読み込み（重複読み込み防止）
  - `gapi.load('picker', callback)` で Picker API を初期化
  - `openFolderPicker(): Promise<{ id: string; name: string }>` メソッドを返す:
    - `google.picker.PickerBuilder` を使用:
      - `ViewId.FOLDERS` を設定（フォルダのみ表示）
      - `setOAuthToken(accessToken)` を設定
      - `setCallback(callback)` で選択結果を処理
      - `build().setVisible(true)` でダイアログを表示
    - コールバックで `Action.PICKED` を検知し、`docs[0].id` / `docs[0].name` を resolve
    - `Action.CANCEL` の場合は reject（または resolve(null) で呼び出し元に判断させる）
- `loading: boolean` 状態を返す（スクリプトロード中の表示制御用）

**参照ファイル**: なし（新規）

## Step 6: フォルダ選択ダイアログコンポーネントの実装 (`src/components/folder-picker-dialog.tsx`)

**目標**: 初期化時にユーザーにフォルダ選択を促すダイアログコンポーネントを実装する。

**方法**:
- `"use client"` ディレクティブを付与
- `FolderPickerDialog` コンポーネント:
  - Props: `{ onSelect: (folder: { id: string; name: string }) => void; onCancel: () => void }`
- 表示内容:
  - 説明テキスト: 「手帳のスキャン画像を保存するフォルダを選択してください。」
  - 「フォルダを選択する」ボタン → `useGooglePicker().openFolderPicker()` を呼び出し
  - 選択完了後、フォルダ名を表示して「このフォルダを使用する」確認ボタン → `onSelect` コールバック
  - 「キャンセル」ボタン → `onCancel` コールバック
- Tailwind CSS でスタイリング（オーバーレイ + モーダル）

**参照ファイル**: `src/lib/use-google-picker.ts`

## Step 7: 初期化フックの実装 (`src/lib/use-initialize-app.ts`)

**目標**: ログイン後に初期化状態を判定し、必要に応じてフォルダ選択ダイアログの表示をトリガーする React フックを実装する。

**方法**:
- `useInitializeApp()` カスタムフック:
  - `useAuth()` から `accessToken` を取得
  - 内部で `SettingsManager` / `IndexManager` をインスタンス化（accessToken から DriveClient を生成）
  - 状態管理:
    - `status: "loading" | "ready" | "needsFolderSelection" | "error"`
    - `settings: Settings | null`
    - `index: AppIndex | null`
    - `error: Error | null`
  - 処理フロー:
    1. 認証完了を検知（`isAuthenticated` が true になったタイミング）
    2. `settingsManager.load()` + `indexManager.load()` を並行で実行
    3. `settings.notebookImageFolderId` の確認:
       - **設定済み**: `client.getFileInfo(folderId)` で存在確認 → 存在すれば `status = "ready"`、不存在なら `status = "needsFolderSelection"`
       - **未設定**: `status = "needsFolderSelection"`
  - フォルダ選択完了時のコールバック `handleFolderSelected(folder: { id: string; name: string })`:
    - `settingsManager.update({ notebookImageFolderId: folder.id, notebookImageFolderName: folder.name })` を呼び出し
    - `status = "ready"` に遷移
  - 戻り値: `{ status, settings, index, error, settingsManager, indexManager, handleFolderSelected }`
- 呼び出し元（レイアウトコンポーネント等）は `status === "needsFolderSelection"` のときに `FolderPickerDialog` をレンダリングする

**参照ファイル**: `src/lib/settings-manager.ts`, `src/lib/index-manager.ts`, `src/lib/drive-client.ts`, `src/lib/auth-context.tsx`, `src/components/folder-picker-dialog.tsx`

# 5. TESTING AND VALIDATION

## ビルドチェック

- `npm run build` が成功すること（TypeScript の型エラーがないこと）
- `npm run lint` が成功すること（ESLint エラーがないこと）

## 手動確認項目

各モジュールの動作は後続 Issue（Issue #14 ルーティング、#15 スキャンセッション管理 等）の実装時に統合テストで検証されるが、実装完了時の単体確認として:

1. **SettingsManager**:
   - `load()` が settings.json なしで呼ばれた場合、デフォルト値でファイルが作成されること
   - 連続した setter 呼び出しで version がインクリメントされること

2. **IndexManager**:
   - `load()` が index.json なしで呼ばれた場合、空の配列を持つデフォルト値でファイルが作成されること
   - `addSession` / `removeSession` 等の操作後に永続化されること

3. **Google Picker フック**:
   - `apis.google.com/js/api.js` が正常に読み込まれること
   - フォルダ選択ダイアログが表示され、選択後にフォルダ情報が返されること

4. **初期化フック**:
   - 初回ログイン時に `status === "needsFolderSelection"` となり、`FolderPickerDialog` が表示されること
   - フォルダ選択後に `status === "ready"` に遷移し、settings に folderId が保存されること
   - 2 回目以降のログインでは即座に `status === "ready"` となること
