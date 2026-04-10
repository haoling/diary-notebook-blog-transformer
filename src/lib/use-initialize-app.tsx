"use client";

import { useState, useEffect, useCallback, createContext, useContext } from "react";
import { useAuth } from "@/lib/auth-context";
import { createDriveClient } from "@/lib/drive-client";
import { SettingsManager } from "@/lib/settings-manager";
import { IndexManager } from "@/lib/index-manager";
import { SessionManager } from "@/lib/session-manager";
import type { Settings, AppIndex } from "@/types/settings";

export type InitializeStatus =
  | "loading"
  | "ready"
  | "needsFolderSelection"
  | "error";

export type InitializeAppResult = {
  status: InitializeStatus;
  settings: Settings | null;
  index: AppIndex | null;
  error: Error | null;
  settingsManager: SettingsManager | null;
  indexManager: IndexManager | null;
  sessionManager: SessionManager | null;
  handleFolderSelected: (folder: { id: string; name: string }) => Promise<void>;
};

const InitializeAppContext = createContext<InitializeAppResult | null>(null);

export function useInitializeApp(): InitializeAppResult {
  const ctx = useContext(InitializeAppContext);
  if (ctx) return ctx;

  // Context プロバイダ外で呼ばれた場合は従来通り独立インスタンスを返す
  return useInitializeAppImpl();
}

function useInitializeAppImpl(): InitializeAppResult {
  const { accessToken, isAuthenticated } = useAuth();
  const [status, setStatus] = useState<InitializeStatus>("loading");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [index, setIndex] = useState<AppIndex | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [settingsManager, setSettingsManager] = useState<SettingsManager | null>(null);
  const [indexManager, setIndexManager] = useState<IndexManager | null>(null);
  const [sessionManager, setSessionManager] = useState<SessionManager | null>(null);

  const handleFolderSelected = useCallback(
    async (folder: { id: string; name: string }, sm: SettingsManager | null) => {
      if (!sm) {
        setError(new Error("SettingsManager が初期化されていません。"));
        setStatus("error");
        return;
      }
      try {
        await sm.update({
          notebookImageFolderId: folder.id,
          notebookImageFolderName: folder.name,
        });
        setSettings(sm.getAll());
        setError(null);
        setStatus("ready");
      } catch (err) {
        setError(
          err instanceof Error
            ? err
            : new Error("フォルダ設定の保存に失敗しました。"),
        );
        setStatus("error");
      }
    },
    [],
  );

  useEffect(() => {
    if (!isAuthenticated || !accessToken) {
      setSettings(null);
      setIndex(null);
      setError(null);
      setSettingsManager(null);
      setIndexManager(null);
      setSessionManager(null);
      if (status !== "loading") setStatus("loading");
      return;
    }

    let cancelled = false;
    const token = accessToken;

    async function initialize() {
      try {
        setStatus("loading");
        setError(null);

        const client = createDriveClient(token);

        const sm = new SettingsManager(client);
        const im = new IndexManager(client);

        const [loadedSettings, loadedIndex] = await Promise.all([
          sm.load(),
          im.load(),
        ]);

        if (cancelled) return;

        setSettingsManager(sm);
        setIndexManager(im);
        setSettings(loadedSettings);
        setIndex(loadedIndex);

        const sessMgr = new SessionManager(client, sm, im);
        setSessionManager(sessMgr);

        const folderId = loadedSettings.notebookImageFolderId;
        if (!folderId) {
          setStatus("needsFolderSelection");
          return;
        }

        setStatus("ready");
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err
              : new Error("初期化に失敗しました。"),
          );
          setStatus("error");
        }
      }
    }

    initialize();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, accessToken]);

  // handleFolderSelected を settingsManager に束縛して返す
  const boundHandleFolderSelected = useCallback(
    (folder: { id: string; name: string }) =>
      handleFolderSelected(folder, settingsManager),
    [handleFolderSelected, settingsManager],
  );

  return {
    status,
    settings,
    index,
    error,
    settingsManager,
    indexManager,
    sessionManager,
    handleFolderSelected: boundHandleFolderSelected,
  };
}

/** 子コンポーネント間で useInitializeApp の状態を共有するプロバイダ。 */
export function InitializeAppProvider({ children }: { children: React.ReactNode }) {
  const result = useInitializeAppImpl();
  return (
    <InitializeAppContext.Provider value={result}>
      {children}
    </InitializeAppContext.Provider>
  );
}
