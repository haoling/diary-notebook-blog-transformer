"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { useInitializeApp } from "@/lib/use-initialize-app";
import { createDriveClient } from "@/lib/drive-client";
import { ImageCaptureModule } from "@/components/ImageCaptureModule";
import { ScannerUploadModule } from "@/components/ScannerUploadModule";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { ScanSession, ScanPage } from "@/types/scan";

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type PageThumbnailProps = {
  page: ScanPage;
  accessToken: string;
  onDelete: () => void;
};

function PageThumbnail({ page, accessToken, onDelete }: PageThumbnailProps) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    const client = createDriveClient(accessToken);

    async function loadThumbnail() {
      setLoadError(false);
      setLoading(true);
      setThumbnailUrl(null);
      try {
        const blob = await client.getFileBlob(page.originalFileId);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setThumbnailUrl(objectUrl);
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadThumbnail();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [page.originalFileId, accessToken]);

  return (
    <div className="group relative rounded-lg border border-slate-200 bg-white overflow-hidden shadow-sm">
      <div className="aspect-[3/4] bg-slate-100">
        {loading && (
          <div className="flex items-center justify-center h-full">
            <div className="text-slate-300 text-sm">読み込み中...</div>
          </div>
        )}
        {loadError && (
          <div className="flex items-center justify-center h-full">
            <div className="text-slate-400 text-sm">表示できません</div>
          </div>
        )}
        {thumbnailUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnailUrl}
            alt={`ページ ${page.id}`}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        )}
      </div>
      <div className="p-2">
        <p className="text-xs text-slate-500">
          {formatDateTime(page.capturedAt)}
        </p>
      </div>
      <button
        type="button"
        onClick={onDelete}
        className="absolute top-1 right-1 rounded-md bg-black/50 p-1 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
        aria-label="ページを削除"
      >
        ✕
      </button>
    </div>
  );
}

export type SessionDetailPanelProps = {
  sessionId: string;
  onBack: () => void;
};

export function SessionDetailPanel({ sessionId, onBack }: SessionDetailPanelProps) {
  const { accessToken } = useAuth();
  const { status, sessionManager } = useInitializeApp();

  const [session, setSession] = useState<ScanSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [addingPage, setAddingPage] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadSession = useCallback(async () => {
    if (!sessionManager || !sessionId) return;
    setLoading(true);
    setLoadError(null);
    setOperationError(null);
    try {
      const s = await sessionManager.loadSession(sessionId);
      setSession(s);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "セッションの読み込みに失敗しました。",
      );
    } finally {
      setLoading(false);
    }
  }, [sessionManager, sessionId]);

  useEffect(() => {
    if (status === "ready" && sessionManager) {
      loadSession();
    }
  }, [status, sessionManager, loadSession]);

  const handleCapture = useCallback(
    async (blob: Blob, fileName: string) => {
      if (!sessionManager || !sessionId) return;
      setAddingPage(true);
      setOperationError(null);
      try {
        await sessionManager.addPage(sessionId, blob, fileName);
        await loadSession();
      } catch (err) {
        setOperationError(err instanceof Error ? err.message : "ページの追加に失敗しました。");
      } finally {
        setAddingPage(false);
      }
    },
    [sessionManager, sessionId, loadSession],
  );

  const handleDeletePage = useCallback(async () => {
    if (!sessionManager || !sessionId || !deleteTarget) return;
    setDeleting(true);
    setOperationError(null);
    try {
      await sessionManager.removePage(sessionId, deleteTarget);
      setDeleteTarget(null);
      await loadSession();
    } catch (err) {
      setOperationError(err instanceof Error ? err.message : "ページの削除に失敗しました。");
    } finally {
      setDeleting(false);
    }
  }, [sessionManager, sessionId, deleteTarget, loadSession]);

  if (status === "loading" || (status === "ready" && loading)) {
    return (
      <div>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 mb-4"
        >
          ← セッション一覧に戻る
        </button>
        <div className="flex items-center justify-center py-12">
          <div className="text-slate-400">読み込み中...</div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 mb-4"
        >
          ← セッション一覧に戻る
        </button>
        <div className="text-center py-12">
          <div className="text-3xl mb-4">⚠️</div>
          <p className="text-red-600">{loadError}</p>
        </div>
      </div>
    );
  }

  if (!session) return null;

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 mb-4"
      >
        ← セッション一覧に戻る
      </button>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">📓 セッション詳細</h1>
          <p className="text-sm text-slate-400 mt-1">
            {formatDateTime(session.createdAt)} ・ {session.pages.length} ページ
          </p>
        </div>
      </div>

      {operationError && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {operationError}
        </div>
      )}

      {accessToken && (
        <div className="mb-8 space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-700">画像を取り込む:</span>
            {addingPage && (
              <span className="text-sm text-slate-400">処理中...</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ImageCaptureModule
              onCapture={handleCapture}
              disabled={addingPage}
            />
            <ScannerUploadModule
              onUpload={handleCapture}
              disabled={addingPage}
            />
          </div>
        </div>
      )}

      {session.pages.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">📷</div>
          <p className="text-lg text-slate-500 mb-2">ページがまだありません</p>
          <p className="text-sm text-slate-400">
            カメラで撮影するか、画像ファイルをアップロードしてください。
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {session.pages.map((page) => (
            <PageThumbnail
              key={page.id}
              page={page}
              accessToken={accessToken ?? ""}
              onDelete={() => setDeleteTarget(page.id)}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="ページの削除"
        message="このページを削除しますか？Google Drive 上の画像も削除されます。この操作は取り消せません。"
        loading={deleting}
        onConfirm={handleDeletePage}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
