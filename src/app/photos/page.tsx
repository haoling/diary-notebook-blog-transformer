"use client";

import { AppShell } from "@/components/AppShell";
import { PhotoPicker } from "@/components/PhotoPicker";
import { useRequireAuth } from "@/lib/use-require-auth";

export default function PhotosPage() {
  const { isAuthorized } = useRequireAuth();
  if (!isAuthorized) return null;

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto py-6 px-4">
        <h1 className="text-xl font-semibold text-slate-800 mb-6">写真インポート</h1>
        <PhotoPicker />
      </div>
    </AppShell>
  );
}
