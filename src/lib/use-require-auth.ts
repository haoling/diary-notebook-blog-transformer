"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

/**
 * 認証が必要なページで使用するフック。
 * 初期化完了後に未ログイン状態であればランディングページ（/）にリダイレクトする。
 */
export function useRequireAuth() {
  const { isAuthenticated, isInitializing } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isInitializing && !isAuthenticated && pathname !== "/") {
      router.replace("/");
    }
  }, [isAuthenticated, isInitializing, pathname, router]);
}
