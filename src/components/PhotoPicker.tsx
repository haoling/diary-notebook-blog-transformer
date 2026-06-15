"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  PhotoImporter,
  type PickerMediaItem,
  type DriveImageFile,
} from "@/lib/photo-importer";
import { createDriveClient } from "@/lib/drive-client";
import { IndexManager } from "@/lib/index-manager";
import { useAuth } from "@/lib/auth-context";
import type { PhotoObject } from "@/types/photo";

type Tab = "google_photos" | "google_drive";

type PhotoPickerProps = {
  /** インポート完了時に呼ばれるコールバック。 */
  onImported?: (photo: PhotoObject) => void;
};

/** Drive thumbnailLink を Bearer トークン付きで fetch して Blob URL を返すコンポーネント。 */
function AuthedThumbnail({
  thumbnailLink,
  accessToken,
  alt,
  className,
}: {
  thumbnailLink: string;
  accessToken: string;
  alt: string;
  className?: string;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const prevUrl = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setBlobUrl(null);
    fetch(thumbnailLink, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.blob() : Promise.reject()))
      .then((blob) => {
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(blob);
        prevUrl.current = url;
        setBlobUrl(url);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
      });
    return () => {
      controller.abort();
      if (prevUrl.current) {
        URL.revokeObjectURL(prevUrl.current);
        prevUrl.current = null;
      }
    };
  }, [thumbnailLink, accessToken]);

  if (!blobUrl) {
    return (
      <div className={`bg-gray-100 flex items-center justify-center text-gray-400 text-xs ${className ?? ""}`}>
        IMG
      </div>
    );
  }
  return <img src={blobUrl} alt={alt} className={className} />;
}

export function PhotoPicker({ onImported }: PhotoPickerProps) {
  const { accessToken } = useAuth();
  const [tab, setTab] = useState<Tab>("google_photos");

  // accessToken 単位で PhotoImporter インスタンスを再利用
  const importerRef = useRef<{ token: string; importer: PhotoImporter } | null>(null);
  const getImporter = useCallback((): PhotoImporter | null => {
    if (!accessToken) return null;
    if (importerRef.current?.token !== accessToken) {
      const client = createDriveClient(accessToken);
      const indexManager = new IndexManager(client);
      importerRef.current = { token: accessToken, importer: new PhotoImporter(client, indexManager, accessToken) };
    }
    return importerRef.current.importer;
  }, [accessToken]);

  // --- Google Photos Picker state ---
  const [gpSession, setGpSession] = useState<{ id: string; pollIntervalMs: number } | null>(null);
  const [gpPolling, setGpPolling] = useState(false);
  const [gpItems, setGpItems] = useState<PickerMediaItem[]>([]);
  const [gpNextPageToken, setGpNextPageToken] = useState<string | undefined>();
  const [gpLoading, setGpLoading] = useState(false);
  const [gpError, setGpError] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Google Drive state ---
  const drSearchGenRef = useRef(0);
  const [drKeyword, setDrKeyword] = useState("");
  const [drFiles, setDrFiles] = useState<DriveImageFile[]>([]);
  const [drNextPageToken, setDrNextPageToken] = useState<string | undefined>();
  const [drLoading, setDrLoading] = useState(false);
  const [drError, setDrError] = useState<string | null>(null);

  // --- importing state ---
  const [importing, setImporting] = useState<string | null>(null);

  // ------------------------------------------------------------------
  // Google Photos Picker フロー
  // ------------------------------------------------------------------

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setGpPolling(false);
  }, []);

  const cancelPickerSession = useCallback(async () => {
    stopPolling();
    if (gpSession) {
      const importer = getImporter();
      importer?.deletePickerSession(gpSession.id).catch(() => {});
    }
    setGpSession(null);
    setGpItems([]);
    setGpNextPageToken(undefined);
    setGpError(null);
  }, [gpSession, getImporter, stopPolling]);

  /** セッションをポーリングし、mediaItemsSet になったらアイテムを取得する。 */
  const pollSession = useCallback(
    (sessionId: string, intervalMs: number, importer: PhotoImporter) => {
      const tick = async () => {
        try {
          const session = await importer.getPickerSession(sessionId);
          if (session.mediaItemsSet) {
            stopPolling();
            setGpLoading(true);
            try {
              const result = await importer.listPickerMediaItems(sessionId);
              setGpItems(result.mediaItems);
              setGpNextPageToken(result.nextPageToken);
            } catch (e) {
              setGpError(e instanceof Error ? e.message : String(e));
            } finally {
              setGpLoading(false);
            }
          } else {
            pollTimerRef.current = setTimeout(tick, intervalMs);
          }
        } catch (e) {
          stopPolling();
          setGpError(e instanceof Error ? e.message : String(e));
        }
      };
      pollTimerRef.current = setTimeout(tick, intervalMs);
    },
    [stopPolling],
  );

  const openGooglePhotosPicker = useCallback(async () => {
    const importer = getImporter();
    if (!importer) return;

    setGpError(null);
    setGpItems([]);
    setGpNextPageToken(undefined);
    setGpLoading(true);

    try {
      const session = await importer.createPickerSession();

      // "5s" → 5000ms
      const rawInterval = session.pollingConfig?.pollInterval ?? "5s";
      const pollIntervalMs = (parseFloat(rawInterval) || 5) * 1000;

      setGpSession({ id: session.id, pollIntervalMs });

      // クリックハンドラ内でポップアップを開く（ポップアップブロッカー対策）
      window.open(session.pickerUri, "_blank", "width=1000,height=700");

      setGpPolling(true);
      pollSession(session.id, pollIntervalMs, importer);
    } catch (e) {
      setGpError(e instanceof Error ? e.message : String(e));
    } finally {
      setGpLoading(false);
    }
  }, [getImporter, pollSession]);

  const loadMorePickerItems = useCallback(async () => {
    if (!gpSession || !gpNextPageToken) return;
    const importer = getImporter();
    if (!importer) return;

    setGpLoading(true);
    try {
      const result = await importer.listPickerMediaItems(gpSession.id, gpNextPageToken);
      setGpItems((prev) => [...prev, ...result.mediaItems]);
      setGpNextPageToken(result.nextPageToken);
    } catch (e) {
      setGpError(e instanceof Error ? e.message : String(e));
    } finally {
      setGpLoading(false);
    }
  }, [gpSession, gpNextPageToken, getImporter]);

  // ------------------------------------------------------------------
  // Google Drive 検索
  // ------------------------------------------------------------------

  const searchDriveImages = useCallback(
    async (append = false) => {
      const importer = getImporter();
      if (!importer) return;

      const gen = ++drSearchGenRef.current;

      setDrLoading(true);
      setDrError(null);
      try {
        const result = await importer.searchDriveImages({
          keyword: drKeyword || undefined,
          pageToken: append ? drNextPageToken : undefined,
        });
        if (gen !== drSearchGenRef.current) return;
        setDrFiles((prev: DriveImageFile[]) => (append ? [...prev, ...result.files] : result.files));
        setDrNextPageToken(result.nextPageToken);
      } catch (e) {
        if (gen !== drSearchGenRef.current) return;
        setDrError(e instanceof Error ? e.message : String(e));
      } finally {
        if (gen === drSearchGenRef.current) setDrLoading(false);
      }
    },
    [getImporter, drKeyword, drNextPageToken],
  );

  // ------------------------------------------------------------------
  // インポート
  // ------------------------------------------------------------------

  const importGooglePhoto = useCallback(
    async (item: PickerMediaItem) => {
      const importer = getImporter();
      if (!importer) return;
      setImporting(item.id);
      try {
        const photo = await importer.importFromGooglePhotos(item);
        onImported?.(photo);
      } catch (e) {
        alert(`インポートに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setImporting(null);
      }
    },
    [getImporter, onImported],
  );

  const importDriveFile = useCallback(
    async (file: DriveImageFile) => {
      const importer = getImporter();
      if (!importer) return;
      setImporting(file.id);
      try {
        const photo = await importer.importFromGoogleDrive(file);
        onImported?.(photo);
      } catch (e) {
        alert(`インポートに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setImporting(null);
      }
    },
    [getImporter, onImported],
  );

  // Tab 切り替え時にポーリングをリセット
  useEffect(() => {
    stopPolling();
    if (gpSession) {
      const importer = getImporter();
      importer?.deletePickerSession(gpSession.id).catch(() => {});
      setGpSession(null);
    }
    setGpItems([]);
    setGpNextPageToken(undefined);
    setGpError(null);
    setDrFiles([]);
    setDrNextPageToken(undefined);
    setDrError(null);
    setDrLoading(false);
    drSearchGenRef.current++;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // アンマウント時にポーリング停止
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  if (!accessToken) {
    return (
      <div className="p-4 text-gray-500 text-sm">
        写真を取り込むにはログインが必要です。
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* タブ */}
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => setTab("google_photos")}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            tab === "google_photos"
              ? "border-b-2 border-blue-500 text-blue-600"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Google Photos
        </button>
        <button
          onClick={() => setTab("google_drive")}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            tab === "google_drive"
              ? "border-b-2 border-blue-500 text-blue-600"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Google Drive
        </button>
      </div>

      {/* Google Photos パネル */}
      {tab === "google_photos" && (
        <div className="flex flex-col gap-3">
          {!gpSession && !gpPolling && gpItems.length === 0 && (
            <div className="flex flex-col items-center gap-4 py-10">
              <p className="text-sm text-gray-500 text-center max-w-sm">
                Google Photos のピッカーを開いて写真を選択してください。選択後、自動的にここに表示されます。
              </p>
              <button
                onClick={openGooglePhotosPicker}
                disabled={gpLoading}
                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {gpLoading ? "準備中…" : "Google Photos を開く"}
              </button>
            </div>
          )}

          {gpPolling && (
            <div className="flex flex-col items-center gap-3 py-10">
              <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-gray-600">Google Photos で写真を選択してください…</p>
              <button
                onClick={cancelPickerSession}
                className="text-xs text-gray-400 hover:text-gray-600 underline"
              >
                キャンセル
              </button>
            </div>
          )}

          {gpError && (
            <div className="flex flex-col gap-2">
              <p className="text-red-500 text-sm">{gpError}</p>
              <button
                onClick={() => { setGpError(null); setGpSession(null); }}
                className="self-start text-xs text-blue-500 hover:underline"
              >
                再試行
              </button>
            </div>
          )}

          {gpItems.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-600">{gpItems.length} 件選択済み</p>
                <button
                  onClick={cancelPickerSession}
                  className="text-xs text-gray-400 hover:text-gray-600 underline"
                >
                  クリア
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {gpItems.map((item) => (
                  <div
                    key={item.id}
                    className="relative group rounded overflow-hidden border border-gray-200 bg-gray-50 aspect-square"
                  >
                    <AuthedThumbnail
                      thumbnailLink={PhotoImporter.getThumbnailUrl(item.mediaFile.baseUrl, 200, 200)}
                      accessToken={accessToken}
                      alt={item.mediaFile.filename}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center gap-1 transition-opacity">
                      <p className="text-white text-xs text-center px-1 truncate w-full">
                        {item.mediaFile.filename}
                      </p>
                      <button
                        onClick={() => importGooglePhoto(item)}
                        disabled={importing === item.id}
                        className="px-2 py-1 bg-blue-500 hover:bg-blue-600 text-white text-xs rounded transition-colors disabled:opacity-50"
                      >
                        {importing === item.id ? "取り込み中…" : "インポート"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {gpNextPageToken && (
                <button
                  onClick={loadMorePickerItems}
                  disabled={gpLoading}
                  className="self-center px-4 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  {gpLoading ? "読み込み中…" : "さらに読み込む"}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Google Drive パネル */}
      {tab === "google_drive" && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            Drive 検索には <code>drive.metadata.readonly</code> スコープが必要です。ログイン時に同意していない場合は再ログインしてください。
          </p>
          <div className="flex gap-2 items-end">
            <label className="flex flex-col gap-1 text-xs text-gray-600 flex-1">
              ファイル名で検索
              <input
                type="text"
                value={drKeyword}
                onChange={(e) => setDrKeyword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && searchDriveImages(false)}
                placeholder="キーワード（空欄で全件）"
                className="border border-gray-300 rounded px-2 py-1 text-sm"
              />
            </label>
            <button
              onClick={() => searchDriveImages(false)}
              disabled={drLoading}
              className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded transition-colors disabled:opacity-50"
            >
              {drLoading ? "検索中…" : "検索"}
            </button>
          </div>

          {drError && (
            <p className="text-red-500 text-sm">{drError}</p>
          )}

          {drFiles.length > 0 && (
            <>
              <div className="flex flex-col gap-1">
                {drFiles.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center gap-3 px-3 py-2 rounded border border-gray-200 hover:bg-gray-50"
                  >
                    {file.thumbnailLink ? (
                      <AuthedThumbnail
                        thumbnailLink={file.thumbnailLink}
                        accessToken={accessToken}
                        alt={file.name}
                        className="w-10 h-10 object-cover rounded flex-shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-10 bg-gray-100 rounded flex-shrink-0 flex items-center justify-center text-gray-400 text-xs">
                        IMG
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">
                        {file.name}
                      </p>
                      {file.createdTime && (
                        <p className="text-xs text-gray-500">
                          {new Date(file.createdTime).toLocaleDateString("ja-JP")}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => importDriveFile(file)}
                      disabled={importing === file.id}
                      className="flex-shrink-0 px-2 py-1 bg-blue-500 hover:bg-blue-600 text-white text-xs rounded transition-colors disabled:opacity-50"
                    >
                      {importing === file.id ? "取り込み中…" : "インポート"}
                    </button>
                  </div>
                ))}
              </div>

              {drNextPageToken && (
                <button
                  onClick={() => searchDriveImages(true)}
                  disabled={drLoading}
                  className="self-center px-4 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  {drLoading ? "読み込み中…" : "さらに読み込む"}
                </button>
              )}
            </>
          )}

          {!drLoading && drFiles.length === 0 && (
            <p className="text-gray-400 text-sm text-center py-6">
              検索ボタンを押してください。
            </p>
          )}
        </div>
      )}
    </div>
  );
}
