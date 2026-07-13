"use client";

import { useParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ArticleComposer } from "@/components/ArticleComposer";
import { useRequireAuth } from "@/lib/use-require-auth";

export function EditArticleContent() {
  const { isAuthorized } = useRequireAuth();
  const params = useParams<{ id: string }>();

  if (!isAuthorized) return null;

  return (
    <AppShell>
      <h1 className="text-2xl font-bold text-slate-800 mb-4">📝 記事を編集</h1>
      <ArticleComposer articleId={params.id} />
    </AppShell>
  );
}
