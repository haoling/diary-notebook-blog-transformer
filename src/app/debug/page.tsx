"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth-context";
import { createDriveClient } from "@/lib/drive-client";
import type { DriveFile } from "@/lib/drive-client";
import { useGooglePicker } from "@/lib/use-google-picker";

type FileEntry = {
  file: DriveFile;
  content: unknown | null;
  loading: boolean;
};

type Toast = {
  message: string;
  type: "success" | "error";
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

  const addToast = useCallback((message: string, type: Toast["type"]) => {
    setToasts((prev) => [...prev, { message, type }]);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToasts([]), 4000);
  }, []);

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
