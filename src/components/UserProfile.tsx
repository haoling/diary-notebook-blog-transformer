"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { ReAuthDialog } from "@/components/ReAuthDialog";

const WARNING_THRESHOLD_SEC = 300; // 5分前から警告
const DISMISS_SNOOZE_MS = 60_000;  // 「後で」を押したら1分間非表示

export function UserProfile() {
  const { user, logout, login, tokenExpiresAt } = useAuth();
  const [remainingSec, setRemainingSec] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [snoozedUntil, setSnoozedUntil] = useState<number>(0);

  useEffect(() => {
    if (tokenExpiresAt === null) {
      setRemainingSec(null);
      return;
    }
    // 警告閾値（5分）より前は30秒間隔、閾値内は1秒間隔でカウントダウン更新
    let timerId: ReturnType<typeof setTimeout>;
    const tick = () => {
      const r = Math.round((tokenExpiresAt - Date.now()) / 1000);
      setRemainingSec(r);
      const nextMs = r > WARNING_THRESHOLD_SEC ? 30_000 : 1_000;
      timerId = setTimeout(tick, nextMs);
    };
    tick();
    return () => clearTimeout(timerId);
  }, [tokenExpiresAt]);

  if (!user) return null;

  const showWarning =
    remainingSec !== null &&
    remainingSec <= WARNING_THRESHOLD_SEC &&
    Date.now() >= snoozedUntil;

  const expired = remainingSec !== null && remainingSec <= 0;

  const formatRemaining = () => {
    if (remainingSec === null) return "";
    const sec = Math.max(0, remainingSec);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}分${s.toString().padStart(2, "0")}秒` : `${s}秒`;
  };

  return (
    <>
      <div className="flex items-center gap-3">
        {showWarning && (
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            title={`トークン有効期限: 残り ${formatRemaining()}`}
            className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg border transition-colors ${
              expired
                ? "bg-red-50 border-red-200 text-red-700 hover:bg-red-100"
                : "bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100"
            }`}
          >
            <span aria-hidden="true">{expired ? "🔴" : "⚠️"}</span>
            <span className="hidden sm:inline">
              {expired ? "期限切れ" : `残り ${formatRemaining()}`}
            </span>
          </button>
        )}
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
      {dialogOpen && (
        <ReAuthDialog
          onConfirm={() => {
            setDialogOpen(false);
            login();
          }}
          onDismiss={() => {
            setDialogOpen(false);
            setSnoozedUntil(Date.now() + DISMISS_SNOOZE_MS);
          }}
        />
      )}
    </>
  );
}
