"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { useRequireAuth } from "@/lib/use-require-auth";
import { useInitializeApp } from "@/lib/use-initialize-app";
import { useAuth } from "@/lib/auth-context";
import { createDriveClient } from "@/lib/drive-client";
import { ArticleManager } from "@/lib/article-manager";
import { FolderPickerDialog } from "@/components/folder-picker-dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { IndexArticleEntry } from "@/types/settings";

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

export default function ArticlesPage() {
  const { isAuthorized } = useRequireAuth();
  const { accessToken } = useAuth();
  const router = useRouter();
  const {
    status,
    index,
    indexManager,
    error,
    handleFolderSelected,
  } = useInitializeApp();

  const [articles, setArticles] = useState<IndexArticleEntry[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const articleManager = useMemo(() => {
    if (!accessToken || !indexManager) return null;
    const client = createDriveClient(accessToken);
    return new ArticleManager(client, indexManager);
  }, [accessToken, indexManager]);

  const refreshArticles = useCallback(() => {
    if (!indexManager) return;
    const latestIndex = indexManager.getAll();
    const sorted = [...latestIndex.articles].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
    setArticles(sorted);
  }, [indexManager]);

  useEffect(() => {
    if (index) {
      const sorted = [...index.articles].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      );
      setArticles(sorted);
    }
  }, [index]);

  const handleDelete = useCallback(async () => {
    if (!articleManager || !deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await articleManager.deleteArticle(deleteTarget);
      setArticles((prev) => prev.filter((a) => a.id !== deleteTarget));
      refreshArticles();
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "記事の削除に失敗しました。");
    } finally {
      setDeleting(false);
    }
  }, [articleManager, deleteTarget, refreshArticles]);

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
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-800">📝 記事一覧</h1>
        <Link
          href="/articles/new"
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
        >
          + 新規記事
        </Link>
      </div>

      {deleteError && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {deleteError}
        </div>
      )}

      {articles.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">📝</div>
          <p className="text-lg text-slate-500 mb-2">記事がまだありません</p>
          <p className="text-sm text-slate-400">
            「+ 新規記事」ボタンから記事を作成してください。
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {articles.map((article) => (
            <div
              key={article.id}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
            >
              <Link
                href={`/articles/${article.id}`}
                className="flex-1 min-w-0 hover:opacity-80 transition-opacity"
              >
                <div className="flex items-center gap-3">
                  <div className="shrink-0 w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-lg">
                    📝
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">
                      {article.title || "（無題）"}
                    </p>
                    <p className="text-xs text-slate-400">{formatDate(article.date)}</p>
                  </div>
                </div>
              </Link>
              <button
                type="button"
                onClick={() => setDeleteTarget(article.id)}
                className="shrink-0 ml-3 rounded-md p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                aria-label="記事を削除"
              >
                🗑️
              </button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="記事の削除"
        message="この記事を削除しますか？この操作は取り消せません。"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </AppShell>
  );
}
