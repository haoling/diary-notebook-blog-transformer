"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth-context";
import { createDriveClient } from "@/lib/drive-client";
import type { DriveFile } from "@/lib/drive-client";
import { useGooglePicker } from "@/lib/use-google-picker";
import { SettingsManager } from "@/lib/settings-manager";
import { IndexManager } from "@/lib/index-manager";
import { useInitializeApp } from "@/lib/use-initialize-app";
import { FolderPickerDialog } from "@/components/folder-picker-dialog";
import type { Settings, AppIndex } from "@/types/settings";

type FileEntry = {
  file: DriveFile;
  content: unknown | null;
  loading: boolean;
};

type Toast = {
  message: string;
  type: "success" | "error";
};

type LogEntry = {
  timestamp: string;
  message: string;
  type: "info" | "success" | "error";
};

export default function DebugPage() {
  const { accessToken, isAuthenticated, login } = useAuth();
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // フォルダピッカー
  const { loading: pickerLoading, error: pickerError, retry: pickerRetry, openFolderPicker } = useGooglePicker();
  const [picking, setPicking] = useState(false);
  const [pickedFolder, setPickedFolder] = useState<{ id: string; name: string } | null>(null);

  // SettingsManager テスト
  const smRef = useRef<SettingsManager | null>(null);
  const [smLoaded, setSmLoaded] = useState(false);
  const [smLoading, setSmLoading] = useState(false);
  const [smData, setSmData] = useState<Settings | null>(null);
  const [smLogs, setSmLogs] = useState<LogEntry[]>([]);
  const [visionApiKeyInput, setVisionApiKeyInput] = useState("");
  const [folderIdInput, setFolderIdInput] = useState("");
  const [folderNameInput, setFolderNameInput] = useState("");
  const [smUpdateJson, setSmUpdateJson] = useState("{}");

  // IndexManager テスト
  const imRef = useRef<IndexManager | null>(null);
  const [imLoaded, setImLoaded] = useState(false);
  const [imLoading, setImLoading] = useState(false);
  const [imData, setImData] = useState<AppIndex | null>(null);
  const [imLogs, setImLogs] = useState<LogEntry[]>([]);
  const [sessionIdInput, setSessionIdInput] = useState("");
  const [sessionCreatedInput, setSessionCreatedInput] = useState("");
  const [photoIdInput, setPhotoIdInput] = useState("");
  const [photoImportedInput, setPhotoImportedInput] = useState("");
  const [photoSourceInput, setPhotoSourceInput] = useState("google_drive");
  const [articleIdInput, setArticleIdInput] = useState("");
  const [articleTitleInput, setArticleTitleInput] = useState("");
  const [articleDateInput, setArticleDateInput] = useState("");
  const [removeIdInput, setRemoveIdInput] = useState("");

  // useInitializeApp テスト
  const {
    status: initStatus,
    settings: initSettings,
    index: initIndex,
    error: initError,
    settingsManager: initSm,
    indexManager: initIm,
    handleFolderSelected: initHandleFolderSelected,
  } = useInitializeApp();
  const [showFolderPickerDialog, setShowFolderPickerDialog] = useState(false);
  const [initLogs, setInitLogs] = useState<LogEntry[]>([]);

  const addToast = useCallback((message: string, type: Toast["type"]) => {
    setToasts((prev) => [...prev, { message, type }]);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToasts([]), 4000);
  }, []);

  const addLog = useCallback((setter: React.Dispatch<React.SetStateAction<LogEntry[]>>, message: string, type: LogEntry["type"] = "info") => {
    const entry: LogEntry = {
      timestamp: new Date().toLocaleTimeString("ja-JP"),
      message,
      type,
    };
    setter((prev) => [...prev, entry]);
  }, []);

  // --- SettingsManager ハンドラ ---
  const handleSmInit = useCallback(async () => {
    if (!accessToken) return;
    setSmLoading(true);
    try {
      const client = createDriveClient(accessToken);
      const sm = new SettingsManager(client);
      const settings = await sm.load();
      smRef.current = sm;
      setSmData(settings);
      setSmLoaded(true);
      setSmLogs([]);
      addLog(setSmLogs, `初期化成功 (version: ${settings.version ?? "?"})`, "success");
    } catch (err) {
      addToast(`SettingsManager 初期化失敗: ${err instanceof Error ? err.message : String(err)}`, "error");
      addLog(setSmLogs, `初期化失敗: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setSmLoading(false);
    }
  }, [accessToken, addToast, addLog]);

  const handleSmGetAll = useCallback(() => {
    const sm = smRef.current;
    if (!sm || !smLoaded) return;
    try {
      const data = sm.getAll();
      setSmData(data);
      addLog(setSmLogs, "getAll() 実行", "info");
    } catch (err) {
      addLog(setSmLogs, `getAll() エラー: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }, [smLoaded, addLog]);

  const handleSmGetVisionApiKey = useCallback(() => {
    const sm = smRef.current;
    if (!sm || !smLoaded) return;
    const key = sm.getVisionApiKey();
    addLog(setSmLogs, `getVisionApiKey() → ${key ?? "(undefined)"}`, "info");
  }, [smLoaded, addLog]);

  const handleSmSetVisionApiKey = useCallback(async () => {
    const sm = smRef.current;
    if (!sm || !smLoaded) return;
    try {
      const val = visionApiKeyInput || undefined;
      await sm.setVisionApiKey(val);
      setSmData(sm.getAll());
      addLog(setSmLogs, `setVisionApiKey("${val ?? "(undefined)"}")`, "success");
      setVisionApiKeyInput("");
    } catch (err) {
      addLog(setSmLogs, `setVisionApiKey() エラー: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }, [smLoaded, visionApiKeyInput, addLog]);

  const handleSmGetFolderId = useCallback(() => {
    const sm = smRef.current;
    if (!sm || !smLoaded) return;
    addLog(setSmLogs, `getNotebookImageFolderId() → ${sm.getNotebookImageFolderId() ?? "(undefined)"}`, "info");
  }, [smLoaded, addLog]);

  const handleSmSetFolderId = useCallback(async () => {
    const sm = smRef.current;
    if (!sm || !smLoaded) return;
    try {
      const val = folderIdInput || undefined;
      await sm.setNotebookImageFolderId(val);
      setSmData(sm.getAll());
      addLog(setSmLogs, `setNotebookImageFolderId("${val ?? "(undefined)"}")`, "success");
      setFolderIdInput("");
    } catch (err) {
      addLog(setSmLogs, `setNotebookImageFolderId() エラー: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }, [smLoaded, folderIdInput, addLog]);

  const handleSmGetFolderName = useCallback(() => {
    const sm = smRef.current;
    if (!sm || !smLoaded) return;
    addLog(setSmLogs, `getNotebookImageFolderName() → ${sm.getNotebookImageFolderName() ?? "(undefined)"}`, "info");
  }, [smLoaded, addLog]);

  const handleSmSetFolderName = useCallback(async () => {
    const sm = smRef.current;
    if (!sm || !smLoaded) return;
    try {
      const val = folderNameInput || undefined;
      await sm.setNotebookImageFolderName(val);
      setSmData(sm.getAll());
      addLog(setSmLogs, `setNotebookImageFolderName("${val ?? "(undefined)"}")`, "success");
      setFolderNameInput("");
    } catch (err) {
      addLog(setSmLogs, `setNotebookImageFolderName() エラー: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }, [smLoaded, folderNameInput, addLog]);

  const handleSmUpdate = useCallback(async () => {
    const sm = smRef.current;
    if (!sm || !smLoaded) return;
    try {
      const partial = JSON.parse(smUpdateJson) as Partial<Omit<Settings, "version">>;
      await sm.update(partial);
      setSmData(sm.getAll());
      addLog(setSmLogs, `update(${JSON.stringify(partial)})`, "success");
    } catch (err) {
      addLog(setSmLogs, `update() エラー: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }, [smLoaded, smUpdateJson, addLog]);

  // --- IndexManager ハンドラ ---
  const handleImInit = useCallback(async () => {
    if (!accessToken) return;
    setImLoading(true);
    try {
      const client = createDriveClient(accessToken);
      const im = new IndexManager(client);
      const idx = await im.load();
      imRef.current = im;
      setImData(idx);
      setImLoaded(true);
      setImLogs([]);
      addLog(setImLogs, `初期化成功 (version: ${idx.version ?? "?"}, sessions: ${idx.sessions.length}, photos: ${idx.photos.length}, articles: ${idx.articles.length})`, "success");
    } catch (err) {
      addToast(`IndexManager 初期化失敗: ${err instanceof Error ? err.message : String(err)}`, "error");
      addLog(setImLogs, `初期化失敗: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setImLoading(false);
    }
  }, [accessToken, addToast, addLog]);

  const reloadImData = useCallback(() => {
    const im = imRef.current;
    if (!im || !imLoaded) return;
    try {
      setImData(im.getAll());
    } catch { /* ignore */ }
  }, [imLoaded]);

  const handleImAddSession = useCallback(async () => {
    const im = imRef.current;
    if (!im || !imLoaded || !sessionIdInput) return;
    try {
      await im.addSession({ id: sessionIdInput, createdAt: sessionCreatedInput || new Date().toISOString() });
      reloadImData();
      addLog(setImLogs, `addSession({ id: "${sessionIdInput}" })`, "success");
      setSessionIdInput("");
      setSessionCreatedInput("");
    } catch (err) {
      addLog(setImLogs, `addSession() エラー: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }, [imLoaded, sessionIdInput, sessionCreatedInput, reloadImData, addLog]);

  const handleImRemoveSession = useCallback(async () => {
    const im = imRef.current;
    if (!im || !imLoaded || !removeIdInput) return;
    try {
      await im.removeSession(removeIdInput);
      reloadImData();
      addLog(setImLogs, `removeSession("${removeIdInput}")`, "success");
      setRemoveIdInput("");
    } catch (err) {
      addLog(setImLogs, `removeSession() エラー: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }, [imLoaded, removeIdInput, reloadImData, addLog]);

  const handleImAddPhoto = useCallback(async () => {
    const im = imRef.current;
    if (!im || !imLoaded || !photoIdInput) return;
    try {
      await im.addPhoto({ id: photoIdInput, importedAt: photoImportedInput || new Date().toISOString(), sourceType: photoSourceInput as "google_photos" | "google_drive" });
      reloadImData();
      addLog(setImLogs, `addPhoto({ id: "${photoIdInput}", sourceType: "${photoSourceInput}" })`, "success");
      setPhotoIdInput("");
      setPhotoImportedInput("");
    } catch (err) {
      addLog(setImLogs, `addPhoto() エラー: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }, [imLoaded, photoIdInput, photoImportedInput, photoSourceInput, reloadImData, addLog]);

  const handleImRemovePhoto = useCallback(async () => {
    const im = imRef.current;
    if (!im || !imLoaded || !removeIdInput) return;
    try {
      await im.removePhoto(removeIdInput);
      reloadImData();
      addLog(setImLogs, `removePhoto("${removeIdInput}")`, "success");
      setRemoveIdInput("");
    } catch (err) {
      addLog(setImLogs, `removePhoto() エラー: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }, [imLoaded, removeIdInput, reloadImData, addLog]);

  const handleImAddArticle = useCallback(async () => {
    const im = imRef.current;
    if (!im || !imLoaded || !articleIdInput) return;
    try {
      await im.addArticle({ id: articleIdInput, title: articleTitleInput, date: articleDateInput || new Date().toISOString().slice(0, 10) });
      reloadImData();
      addLog(setImLogs, `addArticle({ id: "${articleIdInput}", title: "${articleTitleInput}" })`, "success");
      setArticleIdInput("");
      setArticleTitleInput("");
      setArticleDateInput("");
    } catch (err) {
      addLog(setImLogs, `addArticle() エラー: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }, [imLoaded, articleIdInput, articleTitleInput, articleDateInput, reloadImData, addLog]);

  const handleImRemoveArticle = useCallback(async () => {
    const im = imRef.current;
    if (!im || !imLoaded || !removeIdInput) return;
    try {
      await im.removeArticle(removeIdInput);
      reloadImData();
      addLog(setImLogs, `removeArticle("${removeIdInput}")`, "success");
      setRemoveIdInput("");
    } catch (err) {
      addLog(setImLogs, `removeArticle() エラー: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }, [imLoaded, removeIdInput, reloadImData, addLog]);

  // --- useInitializeApp ハンドラ ---
  const handleInitFolderSelected = useCallback(async (folder: { id: string; name: string }) => {
    setShowFolderPickerDialog(false);
    addLog(setInitLogs, `フォルダ選択: ${folder.name} (${folder.id})`, "info");
    await initHandleFolderSelected(folder);
    addLog(setInitLogs, "handleFolderSelected() 完了", "success");
  }, [initHandleFolderSelected, addLog]);

  useEffect(() => {
    if (initStatus !== "loading" && initLogs.length === 0) {
      addLog(setInitLogs, `ステータス遷移: ${initStatus}`, "info");
    } else if (initStatus === "error" && initError) {
      addLog(setInitLogs, `エラー: ${initError.message}`, "error");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initStatus]);

  const loadFiles = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const client = createDriveClient(accessToken);
      const appDataFiles = await client.listAppDataFiles();
      const entries: FileEntry[] = appDataFiles.map((file) => ({
        file,
        content: null,
        loading: false,
      }));
      setFiles(entries);
      setSelectedIndex(null);
    } catch (err) {
      addToast(
        `ファイル一覧の取得に失敗: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    } finally {
      setLoading(false);
    }
  }, [accessToken, addToast]);

  const loadFileContent = useCallback(
    async (index: number) => {
      if (!accessToken || index < 0 || index >= files.length) return;
      const entry = files[index];
      if (entry.content !== null || entry.loading) return;

      setFiles((prev) =>
        prev.map((f, i) => (i === index ? { ...f, loading: true } : f)),
      );

      try {
        const client = createDriveClient(accessToken);
        const content = await client.getFileContent<unknown>(entry.file.id);
        setFiles((prev) =>
          prev.map((f, i) =>
            i === index ? { ...f, content, loading: false } : f,
          ),
        );
      } catch (err) {
        addToast(
          `ファイル内容の取得に失敗: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
        setFiles((prev) =>
          prev.map((f, i) => (i === index ? { ...f, loading: false } : f)),
        );
      }
    },
    [accessToken, files, addToast],
  );

  const handleSelectFile = useCallback(
    (index: number) => {
      setSelectedIndex(index);
      loadFileContent(index);
    },
    [loadFileContent],
  );

  const handleDeleteFile = useCallback(
    async (index: number) => {
      if (!accessToken) return;
      const entry = files[index];
      if (!confirm(`ファイル「${entry.file.name}」を削除しますか？`)) return;

      try {
        const client = createDriveClient(accessToken);
        await client.deleteFile(entry.file.id);
        addToast(`「${entry.file.name}」を削除しました`, "success");
        setFiles((prev) => prev.filter((_, i) => i !== index));
        if (selectedIndex === index) setSelectedIndex(null);
        else if (selectedIndex !== null && selectedIndex > index)
          setSelectedIndex((prev) => (prev ?? 1) - 1);
      } catch (err) {
        addToast(
          `削除に失敗: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
      }
    },
    [accessToken, files, selectedIndex, addToast],
  );

  const handleResetAll = useCallback(async () => {
    if (!accessToken || files.length === 0) return;

    try {
      const client = createDriveClient(accessToken);
      for (const entry of files) {
        await client.deleteFile(entry.file.id);
      }
      addToast("全データを初期化しました", "success");
      setFiles([]);
      setSelectedIndex(null);
      setConfirmReset(false);
    } catch (err) {
      addToast(
        `初期化に失敗: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
      setConfirmReset(false);
    }
  }, [accessToken, files, addToast]);

  useEffect(() => {
    if (isAuthenticated && accessToken && !initialized) {
      loadFiles();
      setInitialized(true);
    }
  }, [isAuthenticated, accessToken, initialized, loadFiles]);

  const selectedEntry =
    selectedIndex !== null && selectedIndex >= 0 && selectedIndex < files.length
      ? files[selectedIndex]
      : null;

  const handleRefresh = useCallback(() => {
    setInitialized(false);
    loadFiles();
  }, [loadFiles]);

  const handleOpenPicker = useCallback(async () => {
    if (!accessToken) return;
    setPicking(true);
    setPickedFolder(null);
    try {
      const result = await openFolderPicker(accessToken);
      if (result) {
        setPickedFolder(result);
        addToast(`フォルダを選択: ${result.name} (${result.id})`, "success");
      } else {
        addToast("フォルダ選択がキャンセルされました", "error");
      }
    } finally {
      setPicking(false);
    }
  }, [accessToken, openFolderPicker, addToast]);

  if (!isAuthenticated) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100">
        <div className="max-w-4xl mx-auto px-4 py-16 text-center">
          <h1 className="text-2xl font-bold text-slate-800 mb-4">
            🔧 デバッグ画面
          </h1>
          <p className="text-slate-600 mb-8">Google ログインが必要です</p>
          <button
            onClick={login}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
          >
            ログイン
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <span className="text-lg font-bold text-slate-800">
            🔧 デバッグ画面
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={handleRefresh}
              disabled={loading}
              className="px-3 py-1.5 text-sm bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition disabled:opacity-50"
            >
              {loading ? "読み込み中..." : "🔄 更新"}
            </button>
          </div>
        </div>
      </header>

      {toasts.length > 0 && (
        <div className="fixed top-20 right-4 z-50 flex flex-col gap-2">
          {toasts.map((toast, i) => (
            <div
              key={i}
              className={`px-4 py-3 rounded-lg shadow-lg text-sm text-white ${
                toast.type === "success" ? "bg-green-600" : "bg-red-600"
              }`}
            >
              {toast.message}
            </div>
          ))}
        </div>
      )}

      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* 統計サマリー */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <StatCard
            label="総ファイル数"
            value={files.length}
            accent="bg-blue-50 text-blue-700"
          />
          <StatCard
            label="インデックス"
            value={
              files.filter((f) => f.file.name === "index.json").length
            }
            accent="bg-green-50 text-green-700"
          />
          <StatCard
            label="設定"
            value={
              files.filter((f) => f.file.name === "settings.json").length
            }
            accent="bg-purple-50 text-purple-700"
          />
          <StatCard
            label="データファイル"
            value={
              files.filter(
                (f) =>
                  !["index.json", "settings.json"].includes(f.file.name),
              ).length
            }
            accent="bg-amber-50 text-amber-700"
          />
        </div>

        {/* メインコンテンツ */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ファイル一覧 */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100">
                <h2 className="font-semibold text-slate-700">
                  appDataFolder 内のファイル
                </h2>
              </div>
              {files.length === 0 ? (
                <div className="px-4 py-8 text-center text-slate-400 text-sm">
                  データがありません
                </div>
              ) : (
                <ul className="divide-y divide-slate-100 max-h-[60vh] overflow-y-auto">
                  {files.map((entry, i) => (
                    <li key={entry.file.id}>
                      <button
                        onClick={() => handleSelectFile(i)}
                        className={`w-full text-left px-4 py-3 hover:bg-slate-50 transition flex items-center justify-between group ${
                          selectedIndex === i ? "bg-blue-50" : ""
                        }`}
                      >
                        <div className="min-w-0">
                          <div
                            className={`text-sm font-medium truncate ${
                              selectedIndex === i
                                ? "text-blue-700"
                                : "text-slate-700"
                            }`}
                          >
                            {getCategoryIcon(entry.file.name)}{" "}
                            {entry.file.name}
                          </div>
                          <div className="text-xs text-slate-400 mt-0.5">
                            ID: {entry.file.id}
                          </div>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteFile(i);
                          }}
                          className="opacity-0 group-hover:opacity-100 ml-2 px-2 py-1 text-xs text-red-500 hover:bg-red-50 rounded transition shrink-0"
                        >
                          削除
                        </button>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* ファイル内容 */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <h2 className="font-semibold text-slate-700">
                  {selectedEntry
                    ? selectedEntry.file.name
                    : "ファイルを選択してください"}
                </h2>
                {selectedEntry && (
                  <button
                    onClick={() => handleDeleteFile(selectedIndex!)}
                    className="px-3 py-1 text-xs text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition"
                  >
                    このファイルを削除
                  </button>
                )}
              </div>
              <div className="p-4">
                {!selectedEntry ? (
                  <div className="text-center text-slate-400 text-sm py-12">
                    左のファイル一覧からファイルを選択すると、内容が表示されます
                  </div>
                ) : selectedEntry.loading ? (
                  <div className="text-center text-slate-400 text-sm py-12">
                    読み込み中...
                  </div>
                ) : selectedEntry.content !== null ? (
                  <pre className="text-xs text-slate-700 bg-slate-50 rounded-lg p-4 overflow-auto max-h-[60vh] whitespace-pre-wrap break-words font-mono">
                    {JSON.stringify(selectedEntry.content, null, 2)}
                  </pre>
                ) : (
                  <div className="text-center text-slate-400 text-sm py-12">
                    内容の取得に失敗しました
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* SettingsManager テスト */}
        <div className="mt-8 bg-white rounded-2xl shadow-sm border border-purple-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-purple-100 bg-purple-50">
            <h2 className="font-semibold text-purple-700">
              ⚙️ SettingsManager テスト
            </h2>
          </div>
          <div className="p-4 space-y-4">
            <p className="text-sm text-slate-600">
              SettingsManager の load / getAll / getter / setter / update を個別にテストします。
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={handleSmInit}
                disabled={smLoading}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition text-sm disabled:opacity-50"
              >
                {smLoading ? "初期化中…" : smLoaded ? "🔄 再初期化" : "初期化"}
              </button>
              {smLoaded && (
                <button
                  onClick={handleSmGetAll}
                  className="px-3 py-2 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 transition text-sm"
                >
                  getAll()
                </button>
              )}
            </div>

            {smData && (
              <pre className="text-xs text-slate-700 bg-purple-50 rounded-lg p-3 overflow-auto max-h-40 whitespace-pre-wrap break-words font-mono">
                {JSON.stringify(smData, null, 2)}
              </pre>
            )}

            {smLoaded && (
              <div className="space-y-3 border-t border-purple-100 pt-4">
                {/* visionApiKey */}
                <div className="space-y-1">
                  <div className="text-xs font-medium text-slate-500">visionApiKey</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={visionApiKeyInput}
                      onChange={(e) => setVisionApiKeyInput(e.target.value)}
                      placeholder="API キーを入力（空欄で undefined）"
                      className="flex-1 min-w-[200px] px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-300"
                    />
                    <button onClick={handleSmGetVisionApiKey} className="px-3 py-1.5 text-xs bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 transition">取得</button>
                    <button onClick={handleSmSetVisionApiKey} className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition">設定</button>
                  </div>
                </div>
                {/* notebookImageFolderId */}
                <div className="space-y-1">
                  <div className="text-xs font-medium text-slate-500">notebookImageFolderId</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={folderIdInput}
                      onChange={(e) => setFolderIdInput(e.target.value)}
                      placeholder="フォルダIDを入力"
                      className="flex-1 min-w-[200px] px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-300"
                    />
                    <button onClick={handleSmGetFolderId} className="px-3 py-1.5 text-xs bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 transition">取得</button>
                    <button onClick={handleSmSetFolderId} className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition">設定</button>
                  </div>
                </div>
                {/* notebookImageFolderName */}
                <div className="space-y-1">
                  <div className="text-xs font-medium text-slate-500">notebookImageFolderName</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={folderNameInput}
                      onChange={(e) => setFolderNameInput(e.target.value)}
                      placeholder="フォルダ名を入力"
                      className="flex-1 min-w-[200px] px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-300"
                    />
                    <button onClick={handleSmGetFolderName} className="px-3 py-1.5 text-xs bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 transition">取得</button>
                    <button onClick={handleSmSetFolderName} className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition">設定</button>
                  </div>
                </div>
                {/* update() 一括更新 */}
                <div className="space-y-1 border-t border-purple-100 pt-3">
                  <div className="text-xs font-medium text-slate-500">update() — JSON で一括更新</div>
                  <textarea
                    value={smUpdateJson}
                    onChange={(e) => setSmUpdateJson(e.target.value)}
                    rows={2}
                    className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-300 font-mono"
                    placeholder='{"visionApiKey": "xxx", "notebookImageFolderId": "yyy"}'
                  />
                  <button onClick={handleSmUpdate} className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition">update() 実行</button>
                </div>
              </div>
            )}

            {smLogs.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-slate-500 hover:text-slate-700">操作ログ ({smLogs.length})</summary>
                <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                  {smLogs.map((log, i) => (
                    <div key={i} className={log.type === "error" ? "text-red-600" : log.type === "success" ? "text-green-600" : "text-slate-600"}>
                      <span className="text-slate-400">[{log.timestamp}]</span> {log.message}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        </div>

        {/* IndexManager テスト */}
        <div className="mt-8 bg-white rounded-2xl shadow-sm border border-green-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-green-100 bg-green-50">
            <h2 className="font-semibold text-green-700">
              📋 IndexManager テスト
            </h2>
          </div>
          <div className="p-4 space-y-4">
            <p className="text-sm text-slate-600">
              IndexManager の load / getAll / add / remove を個別にテストします。
            </p>
            <button
              onClick={handleImInit}
              disabled={imLoading}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition text-sm disabled:opacity-50"
            >
              {imLoading ? "初期化中…" : imLoaded ? "🔄 再初期化" : "初期化"}
            </button>

            {imData && (
              <pre className="text-xs text-slate-700 bg-green-50 rounded-lg p-3 overflow-auto max-h-40 whitespace-pre-wrap break-words font-mono">
                {JSON.stringify(imData, null, 2)}
              </pre>
            )}

            {imLoaded && (
              <div className="space-y-4 border-t border-green-100 pt-4">
                {/* Sessions */}
                <div className="space-y-2">
                  <div className="text-xs font-medium text-slate-500">Sessions ({imData?.sessions.length ?? 0})</div>
                  {imData && imData.sessions.length > 0 && (
                    <pre className="text-xs text-slate-600 bg-slate-50 rounded-lg p-2 overflow-auto max-h-24 whitespace-pre-wrap break-words font-mono">
                      {JSON.stringify(imData.sessions, null, 2)}
                    </pre>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <input type="text" value={sessionIdInput} onChange={(e) => setSessionIdInput(e.target.value)} placeholder="ID" className="w-32 px-2 py-1 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300" />
                    <input type="text" value={sessionCreatedInput} onChange={(e) => setSessionCreatedInput(e.target.value)} placeholder="createdAt (ISO)" className="w-48 px-2 py-1 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300" />
                    <button onClick={handleImAddSession} className="px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700 transition">追加</button>
                    <button onClick={handleImRemoveSession} className="px-3 py-1.5 text-xs bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition">削除 (下記ID)</button>
                  </div>
                </div>
                {/* Photos */}
                <div className="space-y-2">
                  <div className="text-xs font-medium text-slate-500">Photos ({imData?.photos.length ?? 0})</div>
                  {imData && imData.photos.length > 0 && (
                    <pre className="text-xs text-slate-600 bg-slate-50 rounded-lg p-2 overflow-auto max-h-24 whitespace-pre-wrap break-words font-mono">
                      {JSON.stringify(imData.photos, null, 2)}
                    </pre>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <input type="text" value={photoIdInput} onChange={(e) => setPhotoIdInput(e.target.value)} placeholder="ID" className="w-32 px-2 py-1 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300" />
                    <input type="text" value={photoImportedInput} onChange={(e) => setPhotoImportedInput(e.target.value)} placeholder="importedAt (ISO)" className="w-48 px-2 py-1 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300" />
                    <select value={photoSourceInput} onChange={(e) => setPhotoSourceInput(e.target.value)} className="px-2 py-1 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300">
                      <option value="google_drive">google_drive</option>
                      <option value="google_photos">google_photos</option>
                    </select>
                    <button onClick={handleImAddPhoto} className="px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700 transition">追加</button>
                    <button onClick={handleImRemovePhoto} className="px-3 py-1.5 text-xs bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition">削除 (下記ID)</button>
                  </div>
                </div>
                {/* Articles */}
                <div className="space-y-2">
                  <div className="text-xs font-medium text-slate-500">Articles ({imData?.articles.length ?? 0})</div>
                  {imData && imData.articles.length > 0 && (
                    <pre className="text-xs text-slate-600 bg-slate-50 rounded-lg p-2 overflow-auto max-h-24 whitespace-pre-wrap break-words font-mono">
                      {JSON.stringify(imData.articles, null, 2)}
                    </pre>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <input type="text" value={articleIdInput} onChange={(e) => setArticleIdInput(e.target.value)} placeholder="ID" className="w-32 px-2 py-1 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300" />
                    <input type="text" value={articleTitleInput} onChange={(e) => setArticleTitleInput(e.target.value)} placeholder="title" className="w-48 px-2 py-1 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300" />
                    <input type="text" value={articleDateInput} onChange={(e) => setArticleDateInput(e.target.value)} placeholder="date (YYYY-MM-DD)" className="w-36 px-2 py-1 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300" />
                    <button onClick={handleImAddArticle} className="px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700 transition">追加</button>
                    <button onClick={handleImRemoveArticle} className="px-3 py-1.5 text-xs bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition">削除 (下記ID)</button>
                  </div>
                </div>
                {/* 共通削除ID入力 */}
                <div className="space-y-1 border-t border-green-100 pt-3">
                  <div className="text-xs font-medium text-slate-500">削除対象 ID（上記の「削除」ボタンで使用）</div>
                  <input
                    type="text"
                    value={removeIdInput}
                    onChange={(e) => setRemoveIdInput(e.target.value)}
                    placeholder="削除するエントリのID"
                    className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300"
                  />
                </div>
              </div>
            )}

            {imLogs.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-slate-500 hover:text-slate-700">操作ログ ({imLogs.length})</summary>
                <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                  {imLogs.map((log, i) => (
                    <div key={i} className={log.type === "error" ? "text-red-600" : log.type === "success" ? "text-green-600" : "text-slate-600"}>
                      <span className="text-slate-400">[{log.timestamp}]</span> {log.message}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        </div>

        {/* useInitializeApp テスト */}
        <div className="mt-8 bg-white rounded-2xl shadow-sm border border-amber-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-amber-100 bg-amber-50">
            <h2 className="font-semibold text-amber-700">
              🚀 useInitializeApp テスト
            </h2>
          </div>
          <div className="p-4 space-y-4">
            <p className="text-sm text-slate-600">
              useInitializeApp フックのステータス遷移とフォルダ選択フローをテストします。ページ表示時に自動初期化されます。
            </p>

            {/* ステータスバッジ */}
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-slate-500">status:</span>
              <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                initStatus === "loading" ? "bg-slate-100 text-slate-600" :
                initStatus === "ready" ? "bg-green-100 text-green-700" :
                initStatus === "needsFolderSelection" ? "bg-amber-100 text-amber-700" :
                "bg-red-100 text-red-700"
              }`}>
                {initStatus}
              </span>
            </div>

            {initError && (
              <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
                {initError.message}
              </div>
            )}

            {/* Settings 表示 */}
            {initSettings && (
              <div className="space-y-1">
                <div className="text-xs font-medium text-slate-500">settings</div>
                <pre className="text-xs text-slate-700 bg-amber-50 rounded-lg p-3 overflow-auto max-h-40 whitespace-pre-wrap break-words font-mono">
                  {JSON.stringify(initSettings, null, 2)}
                </pre>
              </div>
            )}

            {/* Index 表示 */}
            {initIndex && (
              <div className="space-y-1">
                <div className="text-xs font-medium text-slate-500">index</div>
                <pre className="text-xs text-slate-700 bg-amber-50 rounded-lg p-3 overflow-auto max-h-40 whitespace-pre-wrap break-words font-mono">
                  {JSON.stringify(initIndex, null, 2)}
                </pre>
              </div>
            )}

            {/* フォルダ選択ボタン */}
            {initStatus === "needsFolderSelection" && accessToken && (
              <div className="flex flex-wrap items-center gap-3 border-t border-amber-100 pt-3">
                <button
                  onClick={() => setShowFolderPickerDialog(true)}
                  className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition text-sm"
                >
                  FolderPickerDialog を表示
                </button>
                <span className="text-xs text-slate-400">（useInitializeApp のフォルダ選択フロー）</span>
              </div>
            )}

            {/* FolderPickerDialog モーダル */}
            {showFolderPickerDialog && accessToken && (
              <FolderPickerDialog
                accessToken={accessToken}
                onSelect={handleInitFolderSelected}
                onCancel={() => {
                  setShowFolderPickerDialog(false);
                  addLog(setInitLogs, "FolderPickerDialog がキャンセルされました", "info");
                }}
              />
            )}

            {/* マネージャインスタンス情報 */}
            <div className="flex flex-wrap gap-4 text-xs text-slate-500 border-t border-amber-100 pt-3">
              <span>settingsManager: {initSm ? "✅ 初期化済み" : "❌ null"}</span>
              <span>indexManager: {initIm ? "✅ 初期化済み" : "❌ null"}</span>
            </div>

            {initLogs.length > 0 && (
              <details className="text-xs" open>
                <summary className="cursor-pointer text-slate-500 hover:text-slate-700">操作ログ ({initLogs.length})</summary>
                <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                  {initLogs.map((log, i) => (
                    <div key={i} className={log.type === "error" ? "text-red-600" : log.type === "success" ? "text-green-600" : "text-slate-600"}>
                      <span className="text-slate-400">[{log.timestamp}]</span> {log.message}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        </div>

        {/* フォルダピッカーテスト */}
        <div className="mt-8 bg-white rounded-2xl shadow-sm border border-blue-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-blue-100 bg-blue-50">
            <h2 className="font-semibold text-blue-700">
              📂 フォルダピッカーテスト
            </h2>
          </div>
          <div className="p-4">
            <p className="text-sm text-slate-600 mb-4">
              Google Picker API を使ってフォルダを選択するテストです。
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {pickerError ? (
                <>
                  <span className="text-sm text-red-600">
                    Picker API 読み込み失敗: {pickerError.message}
                  </span>
                  <button
                    onClick={pickerRetry}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm"
                  >
                    再試行
                  </button>
                </>
              ) : (
                <button
                  onClick={handleOpenPicker}
                  disabled={pickerLoading || picking}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm disabled:opacity-50"
                >
                  {pickerLoading ? "API 読み込み中…" : picking ? "選択中…" : "フォルダを選択する"}
                </button>
              )}
              {pickedFolder && (
                <div className="text-sm text-slate-700 bg-slate-100 rounded-lg px-3 py-2">
                  <span className="font-medium">{pickedFolder.name}</span>
                  <span className="text-slate-400 ml-2">ID: {pickedFolder.id}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 全初期化セクション */}
        <div className="mt-8 bg-white rounded-2xl shadow-sm border border-red-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-red-100 bg-red-50">
            <h2 className="font-semibold text-red-700">
              ⚠️ 全データ初期化
            </h2>
          </div>
          <div className="p-4">
            <p className="text-sm text-slate-600 mb-4">
              appDataFolder
              内のすべてのファイルを削除します。この操作は取り消せません。
              設定、インデックス、セッションデータ、写真データ、記事データがすべて失われます。
            </p>
            {!confirmReset ? (
              <button
                onClick={() => setConfirmReset(true)}
                disabled={files.length === 0}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                全データを初期化する
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-medium text-red-700">
                  本当に削除しますか？（{files.length} ファイル）
                </span>
                <button
                  onClick={handleResetAll}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
                >
                  はい、初期化する
                </button>
                <button
                  onClick={() => setConfirmReset(false)}
                  className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition"
                >
                  キャンセル
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
      <div className="text-2xl font-bold text-slate-800">{value}</div>
      <div
        className={`text-xs font-medium mt-1 rounded-full px-2 py-0.5 inline-block ${accent}`}
      >
        {label}
      </div>
    </div>
  );
}

function getCategoryIcon(name: string): string {
  if (name === "index.json") return "📋";
  if (name === "settings.json") return "⚙️";
  if (name.startsWith("sessions/")) return "📷";
  if (name.startsWith("photos/")) return "🖼️";
  if (name.startsWith("articles/")) return "📝";
  return "📄";
}
