"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { useRequireAuth } from "@/lib/use-require-auth";
import { useInitializeApp } from "@/lib/use-initialize-app";
import { FolderPickerDialog } from "@/components/folder-picker-dialog";
import type { IndexSessionEntry } from "@/types/settings";

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function SessionsPage() {
  const { isAuthorized } = useRequireAuth();
  const router = useRouter();
  const {
    status,
    index,
    error,
    sessionManager,
    handleFolderSelected,
  } = useInitializeApp();

  const [sessions, setSessions] = useState<IndexSessionEntry[]>([]);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (index) {
      const sorted = [...index.sessions].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      setSessions(sorted);
    }
  }, [index]);

  const handleCreate = useCallback(async () => {
    if (!sessionManager) return;
    setCreating(true);
    try {
      const session = await sessionManager.createSession();
      router.push(`/sessions/${session.id}`);
    } catch (err) {
      console.error("セッション作成に失敗しました:", err);
    } finally {
      setCreating(false);
    }
  }, [sessionManager, router]);

  const handleDelete = useCallback(async () => {
    if (!sessionManager || !deleteTarget) return;
    setDeleting(true);
    try {
      await sessionManager.deleteSession(deleteTarget);
      setDeleteTarget(null);
    } catch (err) {
      console.error("セッション削除に失敗しました:", err);
    } finally {
      setDeleting(false);
    }
  }, [sessionManager, deleteTarget]);

  if (!isAuthorized) return null;

  if (status === "loading") {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-12">
          <div className="text-slate-400">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (status === "needsFolderSelection" && handleFolderSelected) {
    return (
      <AppShell>
        <div className="text-center py-12">
          <div className="text-3xl mb-4">📁</div>
          <p className="text-slate-600 mb-6">
            手帳スキャン画像の保存先フォルダを選択してください。
          </p>
        </div>
        <FolderPickerDialog
          accessToken={""}
          onSelect={handleFolderSelected}
          onCancel={() => router.push("/settings")}
        />
      </AppShell>
    );
  }

  if (status === "error") {
    return (
      <AppShell>
        <div className="text-center py-12">
          <div className="text-3xl mb-4">⚠️</div>
          <p className="text-red-600 mb-2">初期化に失敗しました</p>
          {error && <p className="text-sm text-slate-500">{error.message}</p>}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-800">📓 セッション一覧</h1>
        <button
          type="button"
          onClick={handleCreate}
          disabled={creating}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          {creating ? "作成中..." : "+ 新規セッション"}
        </button>
      </div>

      {sessions.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">📓</div>
          <p className="text-lg text-slate-500 mb-2">セッションがまだありません</p>
          <p className="text-sm text-slate-400">
            「新規セッション」ボタンからスキャンセッションを作成してください。
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((session) => (
            <div
              key={session.id}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
            >
              <Link
                href={`/sessions/${session.id}`}
                className="flex-1 min-w-0 hover:opacity-80 transition-opacity"
              >
                <div className="flex items-center gap-3">
                  <div className="shrink-0 w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-lg">
                    📓
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">
                      {formatDateTime(session.createdAt)}
                    </p>
                    <p className="text-xs text-slate-400">
                      {session.pageCount} ページ
                    </p>
                  </div>
                </div>
              </Link>
              <button
                type="button"
                onClick={() => setDeleteTarget(session.id)}
                className="shrink-0 ml-3 rounded-md p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                aria-label="セッションを削除"
              >
                🗑️
              </button>
            </div>
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
              セッションの削除
            </h2>
            <p className="mb-6 text-sm text-gray-600">
              このセッションとすべてのページを削除しますか？この操作は取り消せません。
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
                onClick={handleDelete}
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
