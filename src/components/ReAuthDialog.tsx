"use client";

interface ReAuthDialogProps {
  onConfirm: () => void;
  onDismiss: () => void;
}

export function ReAuthDialog({ onConfirm, onDismiss }: ReAuthDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reauth-title"
        aria-describedby="reauth-desc"
        className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4"
      >
        <h2 id="reauth-title" className="text-base font-semibold text-slate-800 mb-2">
          セッションの有効期限が近づいています
        </h2>
        <p id="reauth-desc" className="text-sm text-slate-600 mb-5">
          アクセストークンがまもなく期限切れになります。今すぐ再ログインしますか？
        </p>
        <div className="flex justify-end gap-3">
          <button
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
