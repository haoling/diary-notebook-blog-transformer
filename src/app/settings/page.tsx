"use client";

import { AppShell } from "@/components/AppShell";
import { useRequireAuth } from "@/lib/use-require-auth";

export default function SettingsPage() {
  useRequireAuth();

  return (
    <AppShell>
      <h1 className="text-2xl font-bold text-slate-800 mb-4">⚙️ 設定</h1>
      <p className="text-slate-500">アプリケーション設定が表示されます。</p>
    </AppShell>
  );
}
