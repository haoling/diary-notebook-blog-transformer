"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { useRequireAuth } from "@/lib/use-require-auth";
import { useInitializeApp } from "@/lib/use-initialize-app";
import { useAuth } from "@/lib/auth-context";
import { createDriveClient } from "@/lib/drive-client";
import { ImageCaptureModule } from "@/components/ImageCaptureModule";
import { ScannerUploadModule } from "@/components/ScannerUploadModule";
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

export function SessionDetailContent() {
  const { isAuthorized } = useRequireAuth();
  const params = useParams<{ id: string }>();
  const { accessToken } = useAuth();
  const { status, sessionManager, error: initError } = useInitializeApp();

  const [session, setSession] = useState<ScanSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addingPage, setAddingPage] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadSession = useCallback(async () => {
    if (!sessionManager || !params.id) return;
    setLoading(true);
    setError(null);
    try {
      const s = await sessionManager.loadSession(params.id);
      setSession(s);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "セッションの読み込みに失敗しました。",
      );
    } finally {
      setLoading(false);
    }
  }, [sessionManager, params.id]);

  useEffect(() => {
    if (status === "ready" && sessionManager) {
      loadSession();
    }
  }, [status, sessionManager, loadSession]);

  const handleCapture = useCallback(
    async (blob: Blob, fileName: string) => {
      if (!sessionManager || !params.id) return;
      setAddingPage(true);
      setError(null);
      try {
        await sessionManager.addPage(params.id, blob, fileName);
        await loadSession();
      } catch (err) {
        setError(err instanceof Error ? err.message : "ページの追加に失敗しました。");
      } finally {
        setAddingPage(false);
      }
    },
    [sessionManager, params.id, loadSession],
  );

  const handleDeletePage = useCallback(async () => {
    if (!sessionManager || !params.id || !deleteTarget) return;
    setDeleting(true);
    setError(null);
    try {
      await sessionManager.removePage(params.id, deleteTarget);
      setDeleteTarget(null);
      await loadSession();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ページの削除に失敗しました。");
    } finally {
      setDeleting(false);
    }
  }, [sessionManager, params.id, deleteTarget, loadSession]);

  if (!isAuthorized) return null;

  if (status === "loading" || (status === "ready" && loading)) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-12">
          <div className="text-slate-400">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (status === "error" && initError) {
    return (
      <AppShell>
        <div className="text-center py-12">
          <div className="text-3xl mb-4">⚠️</div>
          <p className="text-red-600 mb-2">初期化に失敗しました</p>
          <p className="text-sm text-slate-500">{initError.message}</p>
        </div>
      </AppShell>
    );
  }

  if (error) {
    return (
      <AppShell>
        <div className="mb-4">
          <Link
            href="/sessions"
            className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
          >
            ← セッション一覧に戻る
          </Link>
        </div>
        <div className="text-center py-12">
          <div className="text-3xl mb-4">⚠️</div>
          <p className="text-red-600">{error}</p>
        </div>
      </AppShell>
    );
  }

  if (!session) return null;

  return (
    <AppShell>
      <div className="mb-4">
        <Link
          href="/sessions"
          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
        >
          ← セッション一覧に戻る
        </Link>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">📓 セッション詳細</h1>
          <p className="text-sm text-slate-400 mt-1">
            {formatDateTime(session.createdAt)} ・ {session.pages.length} ページ
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
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

      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className="mx-4 w-full max-w-sm rounded-lg bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-2 text-lg font-semibold text-gray-900">
              ページの削除
            </h2>
            <p className="mb-6 text-sm text-gray-600">
              このページを削除しますか？Google Drive 上の画像も削除されます。この操作は取り消せません。
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleDeletePage}
                disabled={deleting}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? "削除中..." : "削除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
