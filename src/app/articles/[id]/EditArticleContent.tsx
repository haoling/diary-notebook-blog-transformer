"use client";

import { useParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { useRequireAuth } from "@/lib/use-require-auth";

export function EditArticleContent() {
  useRequireAuth();
  const params = useParams<{ id: string }>();

  return (
    <AppShell>
      <h1 className="text-2xl font-bold text-slate-800 mb-4">📝 記事を編集</h1>
      <p className="text-slate-500">
        記事「{params.id}」の編集エディタが表示されます。
      </p>
    </AppShell>
  );
}
