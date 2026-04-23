"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { useInitializeApp } from "@/lib/use-initialize-app";
import { createDriveClient } from "@/lib/drive-client";
import { ImageCaptureModule } from "@/components/ImageCaptureModule";
import { ScannerUploadModule } from "@/components/ScannerUploadModule";
import { PerspectiveCorrectionUI } from "@/components/PerspectiveCorrectionUI";
import { ParagraphSplitUI } from "@/components/ParagraphSplitUI";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { ScanSession, ScanPage, CorrectionResult, SplitResult } from "@/types/scan";

// ---------------------------------------------------------------------------
// 定数・ユーティリティ
// ---------------------------------------------------------------------------

type StepId = "capture" | "correction" | "split" | "ocr";

const STEPS: { id: StepId; label: string; icon: string }[] = [
  { id: "capture", label: "取り込み", icon: "📷" },
  { id: "correction", label: "補正", icon: "✂️" },
  { id: "split", label: "段落分割", icon: "📝" },
  { id: "ocr", label: "OCR", icon: "🔤" },
];

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// ステップナビゲーション
// ---------------------------------------------------------------------------

type StepNavProps = {
  currentStep: StepId;
  onStepChange: (step: StepId) => void;
  session: ScanSession;
};

function correctionProgress(session: ScanSession): { done: number; total: number } {
  const total = session.pages.length;
  const done = session.pages.filter((p) => p.correction !== undefined).length;
  return { done, total };
}

function correctionBadge(session: ScanSession): string | null {
  const { done, total } = correctionProgress(session);
  if (total === 0) return null;
  return `${done}/${total}`;
}

function splitProgress(session: ScanSession): { done: number; total: number } {
  const total = session.pages.filter((p) => p.correction !== undefined).length;
  const done = session.pages.filter((p) => p.split !== undefined).length;
  return { done, total };
}

function splitBadge(session: ScanSession): string | null {
  const { done, total } = splitProgress(session);
  if (total === 0) return null;
  return `${done}/${total}`;
}

function StepNav({ currentStep, onStepChange, session }: StepNavProps) {
  return (
    <nav className="flex items-center gap-1 overflow-x-auto pb-1" aria-label="処理ステップ">
      {STEPS.map((step, idx) => {
        const isActive = currentStep === step.id;
        const hasCorrectedPages = session.pages.some((p) => p.correction !== undefined);
        const isClickable = step.id === "capture" || step.id === "correction" || (step.id === "split" && hasCorrectedPages);
        const badge =
          step.id === "capture"
            ? session.pages.length > 0
              ? `${session.pages.length}`
              : null
            : step.id === "correction"
              ? correctionBadge(session)
              : step.id === "split"
                ? splitBadge(session)
                : null;

        return (
          <div key={step.id} className="flex items-center">
            {idx > 0 && (
              <div className="mx-1 text-slate-300 select-none" aria-hidden="true">›</div>
            )}
            <button
              type="button"
              onClick={() => isClickable && onStepChange(step.id)}
              disabled={!isClickable}
              className={`
                flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors
                ${isActive
                  ? "bg-blue-600 text-white"
                  : isClickable
                    ? "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    : "bg-slate-50 text-slate-400 cursor-not-allowed"
                }
              `}
            >
              <span aria-hidden="true">{step.icon}</span>
              {step.label}
              {badge !== null && (
                <span className={`
                  ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none
                  ${isActive ? "bg-blue-500 text-white" : "bg-slate-200 text-slate-600"}
                `}>
                  {badge}
                </span>
              )}
            </button>
          </div>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// ページサムネイル（取り込みステップ用）
// ---------------------------------------------------------------------------

type PageThumbnailProps = {
  page: ScanPage;
  accessToken: string;
  onDelete: () => void;
};

function PageThumbnail({ page, accessToken, onDelete }: PageThumbnailProps) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    const client = createDriveClient(accessToken);

    async function loadThumbnail() {
      setLoadError(false);
      setLoading(true);
      setThumbnailUrl(null);
      try {
        const blob = await client.getFileBlob(page.originalFileId);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setThumbnailUrl(objectUrl);
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadThumbnail();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [page.originalFileId, accessToken]);

  return (
    <div className="group relative rounded-lg border border-slate-200 bg-white overflow-hidden shadow-sm">
      <div className="aspect-[3/4] bg-slate-100">
        {loading && (
          <div className="flex items-center justify-center h-full">
            <div className="text-slate-300 text-sm">読み込み中...</div>
          </div>
        )}
        {loadError && (
          <div className="flex items-center justify-center h-full">
            <div className="text-slate-400 text-sm">表示できません</div>
          </div>
        )}
        {thumbnailUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnailUrl}
            alt={`ページ ${page.id}`}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        )}
      </div>
      <div className="p-2">
        <p className="text-xs text-slate-500">
          {formatDateTime(page.capturedAt)}
        </p>
      </div>
      <button
        type="button"
        onClick={onDelete}
        className="absolute top-1 right-1 rounded-md bg-black/50 p-1 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
        aria-label="ページを削除"
      >
        ✕
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 補正ステップ：ページ一覧
// ---------------------------------------------------------------------------

type CorrectionPageCardProps = {
  page: ScanPage;
  accessToken: string;
  onSelect: () => void;
};

function CorrectionPageCard({ page, accessToken, onSelect }: CorrectionPageCardProps) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    const client = createDriveClient(accessToken);

    async function loadThumbnail() {
      setLoading(true);
      try {
        const blob = await client.getFileBlob(page.originalFileId);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setThumbnailUrl(objectUrl);
      } catch {
        if (!cancelled) setThumbnailUrl(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadThumbnail();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [page.originalFileId, accessToken]);

  const statusLabel = page.correction === undefined
    ? "未補正"
    : page.correction.skipped
      ? "スキップ"
      : "補正済";

  const statusColor = page.correction === undefined
    ? "bg-amber-100 text-amber-700"
    : page.correction.skipped
      ? "bg-slate-100 text-slate-500"
      : "bg-green-100 text-green-700";

  return (
    <button
      type="button"
      onClick={onSelect}
      className="group relative rounded-lg border border-slate-200 bg-white overflow-hidden shadow-sm hover:border-blue-400 hover:shadow-md transition-all text-left"
    >
      <div className="aspect-[3/4] bg-slate-100">
        {loading && (
          <div className="flex items-center justify-center h-full">
            <div className="text-slate-300 text-sm">読み込み中...</div>
          </div>
        )}
        {thumbnailUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnailUrl}
            alt={`ページ ${page.id}`}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        )}
      </div>
      <div className="p-2 flex items-center justify-between">
        <p className="text-xs text-slate-500">{formatDateTime(page.capturedAt)}</p>
        <span className={`text-[10px] font-medium rounded-full px-1.5 py-0.5 ${statusColor}`}>
          {statusLabel}
        </span>
      </div>
      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20 rounded-lg">
        <span className="rounded-lg bg-white/90 px-3 py-1.5 text-sm font-medium text-slate-700 shadow">
          補正する
        </span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// 分割ステップ：ページ一覧
// ---------------------------------------------------------------------------

type SplitPageCardProps = {
  page: ScanPage;
  accessToken: string;
  onSelect: () => void;
};

function SplitPageCard({ page, accessToken, onSelect }: SplitPageCardProps) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    const client = createDriveClient(accessToken);

    async function loadThumbnail() {
      setLoading(true);
      setThumbnailUrl(null);
      try {
        const blob = await client.getFileBlob(page.originalFileId);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setThumbnailUrl(objectUrl);
      } catch {
        if (!cancelled) setThumbnailUrl(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadThumbnail();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [page.originalFileId, accessToken]);

  const statusLabel = page.split === undefined
    ? "未分割"
    : page.split.paragraphs.length === 0
      ? "分割なし"
      : `${page.split.paragraphs.length}段落`;

  const statusColor = page.split === undefined
    ? "bg-amber-100 text-amber-700"
    : "bg-green-100 text-green-700";

  return (
    <button
      type="button"
      onClick={onSelect}
      className="group relative rounded-lg border border-slate-200 bg-white overflow-hidden shadow-sm hover:border-blue-400 hover:shadow-md transition-all text-left"
    >
      <div className="aspect-[3/4] bg-slate-100">
        {loading && (
          <div className="flex items-center justify-center h-full">
            <div className="text-slate-300 text-sm">読み込み中...</div>
          </div>
        )}
        {thumbnailUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnailUrl}
            alt={`ページ ${page.id}`}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        )}
      </div>
      <div className="p-2 flex items-center justify-between">
        <p className="text-xs text-slate-500">{formatDateTime(page.capturedAt)}</p>
        <span className={`text-[10px] font-medium rounded-full px-1.5 py-0.5 ${statusColor}`}>
          {statusLabel}
        </span>
      </div>
      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20 rounded-lg">
        <span className="rounded-lg bg-white/90 px-3 py-1.5 text-sm font-medium text-slate-700 shadow">
          分割する
        </span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// メインコンポーネント
// ---------------------------------------------------------------------------

export type SessionDetailPanelProps = {
  sessionId: string;
  onBack: () => void;
};

export function SessionDetailPanel({ sessionId, onBack }: SessionDetailPanelProps) {
  const { accessToken } = useAuth();
  const { status, sessionManager } = useInitializeApp();

  const [session, setSession] = useState<ScanSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [addingPage, setAddingPage] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ステップフロー
  const [activeStep, setActiveStep] = useState<StepId>("capture");
  const [correctingPageId, setCorrectingPageId] = useState<string | null>(null);

  // 補正用の画像 Blob URL
  const [correctionImageUrl, setCorrectionImageUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 分割用の状態
  const [splittingPageId, setSplittingPageId] = useState<string | null>(null);
  const [splitImageUrl, setSplitImageUrl] = useState<string | null>(null);
  
  // 分割ページ選択時の並行リクエストを管理するための ref
  const selectPageRequestIdRef = useRef(0);

  const loadSession = useCallback(async () => {
    if (!sessionManager || !sessionId) return;
    setLoading(true);
    setLoadError(null);
    setOperationError(null);
    try {
      const s = await sessionManager.loadSession(sessionId);
      setSession(s);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "セッションの読み込みに失敗しました。",
      );
    } finally {
      setLoading(false);
    }
  }, [sessionManager, sessionId]);

  useEffect(() => {
    if (status === "ready" && sessionManager) {
      loadSession();
    }
  }, [status, sessionManager, loadSession]);

  // ---- 取り込みハンドラ ----

  const handleCapture = useCallback(
    async (blob: Blob, fileName: string) => {
      if (!sessionManager || !sessionId) return;
      setAddingPage(true);
      setOperationError(null);
      try {
        await sessionManager.addPage(sessionId, blob, fileName);
        await loadSession();
      } catch (err) {
        setOperationError(err instanceof Error ? err.message : "ページの追加に失敗しました。");
      } finally {
        setAddingPage(false);
      }
    },
    [sessionManager, sessionId, loadSession],
  );

  const handleDeletePage = useCallback(async () => {
    if (!sessionManager || !sessionId || !deleteTarget) return;
    setDeleting(true);
    setOperationError(null);
    try {
      await sessionManager.removePage(sessionId, deleteTarget);
      setDeleteTarget(null);
      await loadSession();
    } catch (err) {
      setOperationError(err instanceof Error ? err.message : "ページの削除に失敗しました。");
    } finally {
      setDeleting(false);
    }
  }, [sessionManager, sessionId, deleteTarget, loadSession]);

  // ---- 補正ハンドラ ----

  const handleSelectPageForCorrection = useCallback(
    async (page: ScanPage) => {
      if (!accessToken) return;
      setOperationError(null);
      try {
        const client = createDriveClient(accessToken);
        const blob = await client.getFileBlob(page.originalFileId);
        const url = URL.createObjectURL(blob);
        setCorrectionImageUrl(url);
        setCorrectingPageId(page.id);
      } catch (err) {
        setOperationError(err instanceof Error ? err.message : "画像の読み込みに失敗しました。");
      }
    },
    [accessToken],
  );

  const handleSaveCorrection = useCallback(
    async (correction: CorrectionResult) => {
      if (!sessionManager || !sessionId || !correctingPageId) return;
      setSaving(true);
      setOperationError(null);
      try {
        await sessionManager.updatePageCorrection(sessionId, correctingPageId, correction);
        setCorrectingPageId(null);
        if (correctionImageUrl) {
          URL.revokeObjectURL(correctionImageUrl);
          setCorrectionImageUrl(null);
        }
        await loadSession();
      } catch (err) {
        setOperationError(err instanceof Error ? err.message : "補正結果の保存に失敗しました。");
      } finally {
        setSaving(false);
      }
    },
    [sessionManager, sessionId, correctingPageId, correctionImageUrl, loadSession],
  );

  const handleCancelCorrection = useCallback(() => {
    setCorrectingPageId(null);
    if (correctionImageUrl) {
      URL.revokeObjectURL(correctionImageUrl);
      setCorrectionImageUrl(null);
    }
  }, [correctionImageUrl]);

  // 補正用 URL のクリーンアップ
  useEffect(() => {
    return () => {
      if (correctionImageUrl) URL.revokeObjectURL(correctionImageUrl);
    };
  }, [correctionImageUrl]);

  // ---- 分割ハンドラ ----

  const handleSelectPageForSplit = useCallback(
    async (page: ScanPage) => {
      if (!accessToken) return;
      setOperationError(null);
      
      // リクエスト ID を生成して並行実行時の競合を回避
      const requestId = Date.now();
      selectPageRequestIdRef.current = requestId;
      
      try {
        const client = createDriveClient(accessToken);
        const blob = await client.getFileBlob(page.originalFileId);
        
        // 最新のリクエストでない場合は破棄
        if (selectPageRequestIdRef.current !== requestId) {
          return;
        }
        
        const url = URL.createObjectURL(blob);
        setSplitImageUrl(url);
        setSplittingPageId(page.id);
      } catch (err) {
        // 最新のリクエストでのエラーのみを表示
        if (selectPageRequestIdRef.current === requestId) {
          setOperationError(err instanceof Error ? err.message : "画像の読み込みに失敗しました。");
        }
      }
    },
    [accessToken],
  );

  const handleSaveSplit = useCallback(
    async (split: SplitResult) => {
      if (!sessionManager || !sessionId || !splittingPageId) return;
      setSaving(true);
      setOperationError(null);
      try {
        await sessionManager.updatePageSplit(sessionId, splittingPageId, split);
        setSplittingPageId(null);
        if (splitImageUrl) {
          URL.revokeObjectURL(splitImageUrl);
          setSplitImageUrl(null);
        }
        await loadSession();
      } catch (err) {
        setOperationError(err instanceof Error ? err.message : "分割結果の保存に失敗しました。");
      } finally {
        setSaving(false);
      }
    },
    [sessionManager, sessionId, splittingPageId, splitImageUrl, loadSession],
  );

  const handleCancelSplit = useCallback(() => {
    setSplittingPageId(null);
    if (splitImageUrl) {
      URL.revokeObjectURL(splitImageUrl);
      setSplitImageUrl(null);
    }
  }, [splitImageUrl]);

  // 分割用 URL のクリーンアップ
  useEffect(() => {
    return () => {
      if (splitImageUrl) URL.revokeObjectURL(splitImageUrl);
    };
  }, [splitImageUrl]);

  // ---- レンダリング ----

  if (status === "loading" || (status === "ready" && loading)) {
    return (
      <div>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 mb-4"
        >
          ← セッション一覧に戻る
        </button>
        <div className="flex items-center justify-center py-12">
          <div className="text-slate-400">読み込み中...</div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 mb-4"
        >
          ← セッション一覧に戻る
        </button>
        <div className="text-center py-12">
          <div className="text-3xl mb-4">⚠️</div>
          <p className="text-red-600">{loadError}</p>
        </div>
      </div>
    );
  }

  if (!session) return null;

  // 補正UIが表示中の場合
  if (correctingPageId && correctionImageUrl) {
    const page = session.pages.find((p) => p.id === correctingPageId);
    return (
      <div>
        <button
          type="button"
          onClick={handleCancelCorrection}
          disabled={saving}
          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 mb-4 disabled:opacity-50"
        >
          ← 補正ページ一覧に戻る
        </button>

        {operationError && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {operationError}
          </div>
        )}

        <PerspectiveCorrectionUI
          imageUrl={correctionImageUrl}
          existingCorrection={page?.correction}
          onSave={handleSaveCorrection}
          onCancel={handleCancelCorrection}
        />
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 mb-4"
      >
        ← セッション一覧に戻る
      </button>

      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">📓 セッション詳細</h1>
          <p className="text-sm text-slate-400 mt-1">
            {formatDateTime(session.createdAt)}
          </p>
        </div>
      </div>

      {/* ステップナビゲーション */}
      <div className="mb-6">
        <StepNav
          currentStep={activeStep}
          onStepChange={setActiveStep}
          session={session}
        />
      </div>

      {operationError && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {operationError}
        </div>
      )}

      {/* Step 1: 取り込み */}
      {activeStep === "capture" && (
        <div>
          {accessToken && (
            <div className="mb-8 space-y-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-700">画像を取り込む:</span>
                {addingPage && (
                  <span className="text-sm text-slate-400">処理中...</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <ImageCaptureModule
                  onCapture={handleCapture}
                  disabled={addingPage}
                />
                <ScannerUploadModule
                  onUpload={handleCapture}
                  disabled={addingPage}
                />
              </div>
            </div>
          )}

          {session.pages.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-5xl mb-4">📷</div>
              <p className="text-lg text-slate-500 mb-2">ページがまだありません</p>
              <p className="text-sm text-slate-400">
                カメラで撮影するか、画像ファイルをアップロードしてください。
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {session.pages.map((page) => (
                <PageThumbnail
                  key={page.id}
                  page={page}
                  accessToken={accessToken ?? ""}
                  onDelete={() => setDeleteTarget(page.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Step 2: 補正 */}
      {activeStep === "correction" && (
        <div>
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-slate-800 mb-1">✂️ 画像補正</h2>
            <p className="text-sm text-slate-500">
              ページをクリックして台形補正・回転・明るさ/コントラスト/シャープネスを調整します。
            </p>
          </div>

          {session.pages.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-5xl mb-4">📷</div>
              <p className="text-lg text-slate-500 mb-2">ページがまだありません</p>
              <p className="text-sm text-slate-400">
                まず「取り込み」ステップで画像を追加してください。
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {session.pages.map((page) => (
                <CorrectionPageCard
                  key={page.id}
                  page={page}
                  accessToken={accessToken ?? ""}
                  onSelect={() => handleSelectPageForCorrection(page)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Step 3: 段落分割 */}
      {activeStep === "split" && (
        <div>
          {splittingPageId && splitImageUrl ? (
            <div>
              <button
                type="button"
                onClick={handleCancelSplit}
                disabled={saving}
                className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 mb-4 disabled:opacity-50"
              >
                ← 分割ページ一覧に戻る
              </button>

              {operationError && (
                <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                  {operationError}
                </div>
              )}

              <ParagraphSplitUI
                imageUrl={splitImageUrl}
                correction={session.pages.find((p) => p.id === splittingPageId)?.correction}
                existingSplit={session.pages.find((p) => p.id === splittingPageId)?.split}
                onSave={handleSaveSplit}
                onCancel={handleCancelSplit}
              />
            </div>
          ) : (
            <>
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-slate-800 mb-1">📝 段落分割</h2>
                <p className="text-sm text-slate-500">
                  補正済みのページをクリックして、水平罫線・余白で段落境界を自動検出または手動で分割します。
                </p>
              </div>

              {session.pages.filter((p) => p.correction !== undefined).length === 0 ? (
                <div className="text-center py-16">
                  <div className="text-5xl mb-4">✂️</div>
                  <p className="text-lg text-slate-500 mb-2">補正済みのページがありません</p>
                  <p className="text-sm text-slate-400">
                    まず「補正」ステップで画像を補正してください。
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                  {session.pages
                    .filter((p) => p.correction !== undefined)
                    .map((page) => (
                      <SplitPageCard
                        key={page.id}
                        page={page}
                        accessToken={accessToken ?? ""}
                        onSelect={() => handleSelectPageForSplit(page)}
                      />
                    ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Step 4: OCR（準備中） */}
      {activeStep === "ocr" && (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">🔤</div>
          <p className="text-lg text-slate-500 mb-2">OCR（準備中）</p>
          <p className="text-sm text-slate-400">
            段落オブジェクト単位で OCR を実行する機能です。
          </p>
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="ページの削除"
        message="このページを削除しますか？Google Drive 上の画像も削除されます。この操作は取り消せません。"
        loading={deleting}
        onConfirm={handleDeletePage}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
