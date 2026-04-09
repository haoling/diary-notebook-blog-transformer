"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { GoogleLoginButton } from "@/components/GoogleLoginButton";

function LandingPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100">
      <div className="max-w-4xl mx-auto px-4 py-16">
        {/* Hero */}
        <div className="text-center mb-16">
          <h1 className="text-4xl font-bold text-slate-800 mb-4">
            📓 Diary Notebook Blog Transformer
          </h1>
          <p className="text-lg text-slate-600 mb-8">
            システム手帳に書いた日記はデジタルにして、デジカメで撮った写真と一緒にブログ形式になるべきだと思うんですよ
          </p>
          <GoogleLoginButton />
          <p className="mt-4 text-sm text-slate-400">
            ログインすると、ノートの取り込み・OCR・記事編集が使えます
          </p>
        </div>

        {/* Workflow Steps */}
        <div className="grid gap-6 md:grid-cols-3 mb-12">
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
            <div className="text-3xl mb-3">📷</div>
            <h2 className="text-xl font-semibold text-slate-800 mb-2">Step 1: 取り込み</h2>
            <p className="text-slate-600">
              スマホカメラ・スキャナ・ファイルアップロードで手書きノートを取り込みます
            </p>
          </div>

          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
            <div className="text-3xl mb-3">✂️</div>
            <h2 className="text-xl font-semibold text-slate-800 mb-2">Step 2: 段落分割 &amp; OCR</h2>
            <p className="text-slate-600">
              OpenCV.js で段落を検出し、Tesseract.js でテキスト化します
            </p>
          </div>

          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
            <div className="text-3xl mb-3">📝</div>
            <h2 className="text-xl font-semibold text-slate-800 mb-2">Step 3: 記事編集 &amp; 公開</h2>
            <p className="text-slate-600">
              段落・写真を配置して WordPress / Zenn に公開します
            </p>
          </div>
        </div>

        {/* Architecture Info */}
        <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200">
          <h2 className="text-2xl font-bold text-slate-800 mb-6">🔧 技術スタック</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-start gap-3">
              <span className="text-slate-400 text-lg">▸</span>
              <div>
                <span className="font-medium text-slate-700">Next.js (Static Export)</span>
                <span className="text-slate-500"> — 完全静的サイト</span>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-slate-400 text-lg">▸</span>
              <div>
                <span className="font-medium text-slate-700">TypeScript</span>
                <span className="text-slate-500"> — 型安全な開発</span>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-slate-400 text-lg">▸</span>
              <div>
                <span className="font-medium text-slate-700">Tailwind CSS</span>
                <span className="text-slate-500"> — UI スタイリング</span>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-slate-400 text-lg">▸</span>
              <div>
                <span className="font-medium text-slate-700">Google Drive appDataFolder</span>
                <span className="text-slate-500"> — データ保存</span>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-slate-400 text-lg">▸</span>
              <div>
                <span className="font-medium text-slate-700">OpenCV.js / Tesseract.js</span>
                <span className="text-slate-500"> — ブラウザ内画像処理・OCR</span>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-slate-400 text-lg">▸</span>
              <div>
                <span className="font-medium text-slate-700">GitHub Pages</span>
                <span className="text-slate-500"> — 完全無料ホスティング</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="text-center text-slate-400 mt-12 text-sm">
          完全サーバーレス・無料運用 — あなたのデータはあなたの Google Drive に保存されます
        </footer>
      </div>
    </main>
  );
}

export default function Home() {
  const { isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isAuthenticated) {
      router.replace("/sessions");
    }
  }, [isAuthenticated, router]);

  if (isAuthenticated) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100" />
    );
  }

  return <LandingPage />;
}
