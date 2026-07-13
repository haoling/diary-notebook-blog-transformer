"use client";

import { AppShell } from "@/components/AppShell";
import { ArticleComposer } from "@/components/ArticleComposer";
import { useRequireAuth } from "@/lib/use-require-auth";

export default function NewArticlePage() {
  const { isAuthorized } = useRequireAuth();

  if (!isAuthorized) return null;

  return (
    <AppShell>
      <h1 className="text-2xl font-bold text-slate-800 mb-4">✏️ 記事を作成</h1>
      <ArticleComposer />
    </AppShell>
  );
}
