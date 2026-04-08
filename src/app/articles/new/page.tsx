"use client";

import { AppShell } from "@/components/AppShell";
import { useRequireAuth } from "@/lib/use-require-auth";

export default function NewArticlePage() {
  const { isAuthorized } = useRequireAuth();

  if (!isAuthorized) return null;

  return (
    <AppShell>
      <h1 className="text-2xl font-bold text-slate-800 mb-4">✏️ 記事を作成</h1>
      <p className="text-slate-500">記事作成エディタが表示されます。</p>
    </AppShell>
  );
}
