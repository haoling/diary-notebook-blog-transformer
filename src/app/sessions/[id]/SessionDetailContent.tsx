"use client";

import { useParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { useRequireAuth } from "@/lib/use-require-auth";

export function SessionDetailContent() {
  useRequireAuth();
  const params = useParams<{ id: string }>();

  return (
    <AppShell>
      <h1 className="text-2xl font-bold text-slate-800 mb-4">📓 セッション詳細</h1>
      <p className="text-slate-500">
        セッション「{params.id}」の詳細が表示されます。
      </p>
    </AppShell>
  );
}
