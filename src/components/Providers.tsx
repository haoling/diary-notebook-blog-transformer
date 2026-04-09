"use client";

import { GoogleOAuthProvider } from "@react-oauth/google";
import { AuthProvider } from "@/lib/auth-context";
import { InitializeAppProvider } from "@/lib/use-initialize-app";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  return (
    <GoogleOAuthProvider clientId={clientId ?? ""}>
      <AuthProvider>
        <InitializeAppProvider>{children}</InitializeAppProvider>
      </AuthProvider>
    </GoogleOAuthProvider>
  );
}
