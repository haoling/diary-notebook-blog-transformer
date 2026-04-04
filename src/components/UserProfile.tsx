"use client";

import { useAuth } from "@/lib/auth-context";

export function UserProfile() {
  const { user, logout } = useAuth();
  if (!user) return null;

  return (
    <div className="flex items-center gap-3">
      <img
        src={user.picture}
        alt={user.name}
        className="h-9 w-9 rounded-full ring-2 ring-white shadow-sm"
        referrerPolicy="no-referrer"
      />
      <span className="hidden sm:inline text-sm font-medium text-slate-700">
        {user.name}
      </span>
      <button
        onClick={logout}
        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
      >
        ログアウト
      </button>
    </div>
  );
}
