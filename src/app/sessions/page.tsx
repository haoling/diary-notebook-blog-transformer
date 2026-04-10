"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { useRequireAuth } from "@/lib/use-require-auth";
import { useInitializeApp } from "@/lib/use-initialize-app";
import { useAuth } from "@/lib/auth-context";
import { FolderPickerDialog } from "@/components/folder-picker-dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SessionDetailPanel } from "@/components/SessionDetailPanel";
import type { IndexSessionEntry } from "@/types/settings";

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function SessionsPage() {
  const { isAuthorized } = useRequireAuth();
  const { accessToken } = useAuth();
  const router = useRouter();
  const {
    status,
    index,
    indexManager,
    error,
    sessionManager,
    handleFolderSelected,
  } = useInitializeApp();

  const [sessions, setSessions] = useState<IndexSessionEntry[]>([]);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const refreshSessions = useCallback(() => {
    if (indexManager) {
      const latestIndex = indexManager.getAll();
      const sorted = [...latestIndex.sessions].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      setSessions(sorted);
    }
  }, [indexManager]);

  useEffect(() => {
    if (index) {
      const sorted = [...index.sessions].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      setSessions(sorted);
    }
  }, [index]);

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    setActiveSessionId(hash || null);

    const onHashChange = () => {
      setActiveSessionId(window.location.hash.slice(1) || null);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const handleSelectSession = useCallback((id: string) => {
    window.location.hash = id;
  }, []);

  const handleBackToList = useCallback(() => {
    window.location.hash = "";
  }, []);

  const handleCreate = useCallback(async () => {
    if (!sessionManager) return;
    setCreating(true);
    try {
      const session = await sessionManager.createSession();
      refreshSessions();
      window.location.hash = session.id;
    } catch (err) {
      console.error("セッション作成に失敗しました:", err);
    } finally {
      setCreating(false);
    }
  }, [sessionManager, refreshSessions]);

  const handleDelete = useCallback(async () => {
    if (!sessionManager || !deleteTarget) return;
    setDeleting(true);
    try {
      await sessionManager.deleteSession(deleteTarget);
      setSessions((prev) => prev.filter((s) => s.id !== deleteTarget));
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
          accessToken={accessToken ?? ""}
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
      {activeSessionId ? (
        <SessionDetailPanel
          sessionId={activeSessionId}
          onBack={handleBackToList}
        />
      ) : (
        <>
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
                  <button
                    type="button"
                    onClick={() => handleSelectSession(session.id)}
                    className="flex-1 min-w-0 hover:opacity-80 transition-opacity text-left"
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
                          {session.pageCount ?? 0} ページ
                        </p>
                      </div>
                    </div>
                  </button>
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

          <ConfirmDialog
            open={deleteTarget !== null}
            title="セッションの削除"
            message="このセッションとすべてのページを削除しますか？この操作は取り消せません。"
            loading={deleting}
            onConfirm={handleDelete}
            onCancel={() => setDeleteTarget(null)}
          />
        </>
      )}
    </AppShell>
  );
}
