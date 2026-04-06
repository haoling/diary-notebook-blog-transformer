"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { createDriveClient } from "@/lib/drive-client";
import { DriveNotFoundError } from "@/lib/drive-errors";
import { SettingsManager } from "@/lib/settings-manager";
import { IndexManager } from "@/lib/index-manager";
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
  handleFolderSelected: (folder: { id: string; name: string }) => Promise<void>;
};

/**
 * ログイン後に初期化状態を判定し、必要に応じてフォルダ選択をトリガーする React フック。
 *
 * - 認証完了を検知して SettingsManager / IndexManager を初期化
 * - notebookImageFolderId の有無で ready / needsFolderSelection を判定
 * - フォルダ選択後に settings を更新して ready に遷移
 */
export function useInitializeApp(): InitializeAppResult {
  const { accessToken, isAuthenticated } = useAuth();
  const [status, setStatus] = useState<InitializeStatus>("loading");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [index, setIndex] = useState<AppIndex | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [settingsManager, setSettingsManager] = useState<SettingsManager | null>(null);
  const [indexManager, setIndexManager] = useState<IndexManager | null>(null);

  const handleFolderSelected = useCallback(
    async (folder: { id: string; name: string }, sm: SettingsManager | null) => {
      if (!sm) return;
      try {
        await sm.update({
          notebookImageFolderId: folder.id,
          notebookImageFolderName: folder.name,
        });
        setSettings(sm.getAll());
        setStatus("ready");
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "フォルダ設定の保存に失敗しました。";
        setError(new Error(message));
        setStatus("error");
      }
    },
    [],
  );

  useEffect(() => {
    if (!isAuthenticated || !accessToken) {
      setStatus("loading");
      setSettings(null);
      setIndex(null);
      setError(null);
      setSettingsManager(null);
      setIndexManager(null);
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

        const folderId = loadedSettings.notebookImageFolderId;
        if (!folderId) {
          setStatus("needsFolderSelection");
          return;
        }

        // フォルダが実際に存在するか確認
        const exists = await client.fileExists(folderId);
        if (cancelled) return;

        if (exists) {
          setStatus("ready");
        } else {
          setStatus("needsFolderSelection");
        }
      } catch (err) {
        if (err instanceof DriveNotFoundError) {
          if (!cancelled) setStatus("needsFolderSelection");
          return;
        }
        const message =
          err instanceof Error ? err.message : "初期化に失敗しました。";
        if (!cancelled) {
          setError(new Error(message));
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
    handleFolderSelected: boundHandleFolderSelected,
  };
}
