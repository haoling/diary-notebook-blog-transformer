"use client";

import { useEffect, useRef, useCallback } from "react";

interface ReAuthDialogProps {
  onConfirm: () => void;
  onDismiss: () => void;
}

export function ReAuthDialog({ onConfirm, onDismiss }: ReAuthDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const dismissButtonRef = useRef<HTMLButtonElement>(null);

  // 初期フォーカスを「後で」ボタンに設定
  useEffect(() => {
    dismissButtonRef.current?.focus();
  }, []);

  // Esc で閉じる・Tab フォーカストラップ
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onDismiss();
      }
      if (e.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [onDismiss],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onDismiss}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reauth-title"
        aria-describedby="reauth-desc"
        className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="reauth-title" className="text-base font-semibold text-slate-800 mb-2">
          セッションの有効期限が近づいています
        </h2>
        <p id="reauth-desc" className="text-sm text-slate-600 mb-5">
          アクセストークンがまもなく期限切れになります。今すぐ再ログインしますか？
        </p>
        <div className="flex justify-end gap-3">
          <button
            ref={dismissButtonRef}
            type="button"
            onClick={onDismiss}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            後で
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            再ログイン
          </button>
        </div>
      </div>
    </div>
  );
}
