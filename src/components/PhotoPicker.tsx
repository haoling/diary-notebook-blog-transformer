"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  PhotoImporter,
  type GooglePhotosMediaItem,
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
    let cancelled = false;
    // 新しい fetch を開始する前にプレースホルダに戻す
    setBlobUrl(null);
    fetch(thumbnailLink, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then((r) => (r.ok ? r.blob() : Promise.reject()))
      .then((blob) => {
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        prevUrl.current = url;
        setBlobUrl(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
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

  // --- Google Photos state ---
  const [gpStartDate, setGpStartDate] = useState("");
  const [gpEndDate, setGpEndDate] = useState("");
  const [gpKeyword, setGpKeyword] = useState("");
  const [gpItems, setGpItems] = useState<GooglePhotosMediaItem[]>([]);
  const [gpNextPageToken, setGpNextPageToken] = useState<string | undefined>();
  const [gpLoading, setGpLoading] = useState(false);
  const [gpError, setGpError] = useState<string | null>(null);

  // --- Google Drive state ---
  const [drKeyword, setDrKeyword] = useState("");
  const [drFiles, setDrFiles] = useState<DriveImageFile[]>([]);
  const [drNextPageToken, setDrNextPageToken] = useState<string | undefined>();
  const [drLoading, setDrLoading] = useState(false);
  const [drError, setDrError] = useState<string | null>(null);

  // --- importing state ---
  const [importing, setImporting] = useState<string | null>(null);

  const makeImporter = useCallback((): PhotoImporter | null => {
    if (!accessToken) return null;
    const client = createDriveClient(accessToken);
    const indexManager = new IndexManager(client);
    return new PhotoImporter(client, indexManager, accessToken);
  }, [accessToken]);

  // ------------------------------------------------------------------
  // Google Photos 検索
  // ------------------------------------------------------------------

  const searchGooglePhotos = useCallback(
    async (append = false) => {
      const importer = makeImporter();
      if (!importer) return;

      setGpLoading(true);
      setGpError(null);
      try {
        const result = await importer.searchGooglePhotos({
          startDate: gpStartDate || undefined,
          endDate: gpEndDate || undefined,
          keyword: gpKeyword || undefined,
          pageToken: append ? gpNextPageToken : undefined,
        });
        setGpItems((prev: GooglePhotosMediaItem[]) => (append ? [...prev, ...result.mediaItems] : result.mediaItems));
        setGpNextPageToken(result.nextPageToken);
      } catch (e) {
        setGpError(e instanceof Error ? e.message : String(e));
      } finally {
        setGpLoading(false);
      }
    },
    [makeImporter, gpStartDate, gpEndDate, gpKeyword, gpNextPageToken],
  );

  // ------------------------------------------------------------------
  // Google Drive 検索
  // ------------------------------------------------------------------

  const searchDriveImages = useCallback(
    async (append = false) => {
      const importer = makeImporter();
      if (!importer) return;

      setDrLoading(true);
      setDrError(null);
      try {
        const result = await importer.searchDriveImages({
          keyword: drKeyword || undefined,
          pageToken: append ? drNextPageToken : undefined,
        });
        setDrFiles((prev: DriveImageFile[]) => (append ? [...prev, ...result.files] : result.files));
        setDrNextPageToken(result.nextPageToken);
      } catch (e) {
        setDrError(e instanceof Error ? e.message : String(e));
      } finally {
        setDrLoading(false);
      }
    },
    [makeImporter, drKeyword, drNextPageToken],
  );

  // ------------------------------------------------------------------
  // インポート
  // ------------------------------------------------------------------

  const importGooglePhoto = useCallback(
    async (item: GooglePhotosMediaItem) => {
      if (!accessToken) return;
      setImporting(item.id);
      try {
        const client = createDriveClient(accessToken);
        const indexManager = new IndexManager(client);
        const importer = new PhotoImporter(client, indexManager, accessToken);
        const photo = await importer.importFromGooglePhotos(item);
        onImported?.(photo);
      } catch (e) {
        alert(`インポートに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setImporting(null);
      }
    },
    [accessToken, onImported],
  );

  const importDriveFile = useCallback(
    async (file: DriveImageFile) => {
      if (!accessToken) return;
      setImporting(file.id);
      try {
        const client = createDriveClient(accessToken);
        const indexManager = new IndexManager(client);
        const importer = new PhotoImporter(client, indexManager, accessToken);
        const photo = await importer.importFromGoogleDrive(file);
        onImported?.(photo);
      } catch (e) {
        alert(`インポートに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setImporting(null);
      }
    },
    [accessToken, onImported],
  );

  // Tab 切り替え時にリセット
  useEffect(() => {
    setGpItems([]);
    setGpNextPageToken(undefined);
    setDrFiles([]);
    setDrNextPageToken(undefined);
  }, [tab]);

  if (!accessToken) {
    return (
      <div className="p-4 text-gray-500 text-sm">
        写真を検索するにはログインが必要です。
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
          <div className="flex flex-wrap gap-2 items-end">
            <label className="flex flex-col gap-1 text-xs text-gray-600">
              開始日
              <input
                type="date"
                value={gpStartDate}
                onChange={(e) => setGpStartDate(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-gray-600">
              終了日
              <input
                type="date"
                value={gpEndDate}
                onChange={(e) => setGpEndDate(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-gray-600 flex-1 min-w-32">
              キーワード（ファイル名）
              <input
                type="text"
                value={gpKeyword}
                onChange={(e) => setGpKeyword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && searchGooglePhotos(false)}
                placeholder="部分一致"
                className="border border-gray-300 rounded px-2 py-1 text-sm"
              />
            </label>
            <button
              onClick={() => searchGooglePhotos(false)}
              disabled={gpLoading}
              className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded transition-colors disabled:opacity-50"
            >
              {gpLoading ? "検索中…" : "検索"}
            </button>
          </div>

          {gpError && (
            <p className="text-red-500 text-sm">{gpError}</p>
          )}

          {gpItems.length > 0 && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {gpItems.map((item) => (
                <div
                  key={item.id}
                  className="relative group rounded overflow-hidden border border-gray-200 bg-gray-50 aspect-square"
                >
                  <img
                    src={PhotoImporter.getThumbnailUrl(item.baseUrl, 200, 200)}
                    alt={item.filename}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center gap-1 transition-opacity">
                    <p className="text-white text-xs text-center px-1 truncate w-full text-center">
                      {item.filename}
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
          )}

          {/* nextPageToken がある限りページングボタンを表示（キーワードフィルタでヒット0でも続きがある場合がある） */}
          {gpNextPageToken && (
            <button
              onClick={() => searchGooglePhotos(true)}
              disabled={gpLoading}
              className="self-center px-4 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              {gpLoading ? "読み込み中…" : "さらに読み込む"}
            </button>
          )}

          {!gpLoading && gpItems.length === 0 && !gpNextPageToken && (
            <p className="text-gray-400 text-sm text-center py-6">
              日付範囲やキーワードを指定して検索してください。
            </p>
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
