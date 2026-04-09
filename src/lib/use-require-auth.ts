"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

interface RequireAuthResult {
  /** 認証済みでコンテンツを描画してよいか */
  isAuthorized: boolean;
}

/**
 * 認証が必要なページで使用するフック。
 * 未ログイン時はランディングページ（/）にリダイレクトし、
 * 呼び出し側で `isAuthorized` を使ってコンテンツの描画をガードする。
 */
export function useRequireAuth(): RequireAuthResult {
  const { isAuthenticated, isRestoring } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isRestoring && !isAuthenticated && pathname !== "/") {
      router.replace("/");
    }
  }, [isAuthenticated, isRestoring, pathname, router]);

  return { isAuthorized: !isRestoring && isAuthenticated };
}
