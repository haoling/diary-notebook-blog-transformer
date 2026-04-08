"use client";

import { AppShell } from "@/components/AppShell";
import { useRequireAuth } from "@/lib/use-require-auth";

export default function SessionsPage() {
  useRequireAuth();

  return (
    <AppShell>
      <h1 className="text-2xl font-bold text-slate-800 mb-4">📓 セッション一覧</h1>
      <p className="text-slate-500">取り込みセッションの一覧が表示されます。</p>
    </AppShell>
  );
}
