"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

/**
 * 認証が必要なページで使用するフック。
 * 未ログイン時はランディングページ（/）にリダイレクトする。
 * まだ認証状態の初期化中は何もしない。
 */
export function useRequireAuth() {
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // 認証状態の初期化を待つためタイマーで確認
    // auth-context は初期値が isAuthenticated=false なので、
    // マウント直後の誘導を防ぐため少し遅延させる
    const timer = setTimeout(() => {
      if (!isAuthenticated && pathname !== "/") {
        router.replace("/");
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [isAuthenticated, pathname, router]);
}
