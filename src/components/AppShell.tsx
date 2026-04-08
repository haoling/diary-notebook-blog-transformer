"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { Navigation } from "@/components/Navigation";
import { UserProfile } from "@/components/UserProfile";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-lg font-bold text-slate-800 shrink-0">
              📓 DNBT
            </Link>
            <Navigation />
          </div>
          <UserProfile />
        </div>
      </header>
      <div className="max-w-4xl mx-auto px-4 py-8">{children}</div>
    </div>
  );
}
