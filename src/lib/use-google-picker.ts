"use client";

import { useState, useEffect, useCallback, useRef } from "react";

/** Google Picker API の型宣言。 */
declare global {
  interface Window {
    google?: {
      picker: {
        DocsView: new (viewType: string) => DocsViewInstance;
        PickerBuilder: new () => PickerBuilder;
        ViewId: {
          FOLDERS: number;
        };
        Action: {
          PICKED: string;
          CANCEL: string;
        };
        Response: {
          ACTION: string;
          DOCS: string;
        };
        Document: {
          id: string;
          name: string;
        };
      };
    };
    gapi?: {
      load: (api: string, callback: () => void) => void;
    };
  }
}

interface DocsViewInstance {
  setParent: (id: string) => DocsViewInstance;
  setSelectFolderEnabled: (enabled: boolean) => DocsViewInstance;
}

/** PickerBuilder の最小インターフェース。 */
interface PickerBuilder {
  enableFeature: (feature: number) => PickerBuilder;
  addView: (view: unknown) => PickerBuilder;
  setOAuthToken: (token: string) => PickerBuilder;
  setCallback: (callback: (data: Record<string, unknown>) => void) => PickerBuilder;
  setDeveloperKey: (key: string) => PickerBuilder;
  setAppId: (appId: string) => PickerBuilder;
  build: () => { setVisible: (visible: boolean) => void };
}

const PICKER_SCRIPT_SRC = "https://apis.google.com/js/api.js";

/**
 * Google Picker API を動的ロードし、フォルダ選択ダイアログを表示する React フック。
 *
 * @returns loading — スクリプトロード中かどうか
 * @returns error — ロード失敗時のエラー
 * @returns retry — ロード失敗後に再試行する関数
 * @returns openFolderPicker — フォルダ選択ダイアログを開き、選択結果を返す Promise
 */
export function useGooglePicker() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);
  const pickerReady = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    return () => { mounted.current = false; };
  }, []);

  const initPicker = useCallback(() => {
    if (!window.gapi) {
      if (mounted.current) {
        setLoading(false);
        setError(new Error("Google API ライブラリの読み込みに失敗しました。"));
      }
      return;
    }
    window.gapi.load("picker", () => {
      pickerReady.current = true;
      if (mounted.current) {
        setLoading(false);
        setError(null);
      }
    });
  }, []);

  useEffect(() => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[src="${PICKER_SCRIPT_SRC}"]`,
    );

    if (existingScript) {
      initPicker();
      const handleScriptEvent = () => { initPicker(); };
      existingScript.addEventListener("load", handleScriptEvent, { once: true });
      existingScript.addEventListener("error", handleScriptEvent, { once: true });
      return () => {
        existingScript.removeEventListener("load", handleScriptEvent);
        existingScript.removeEventListener("error", handleScriptEvent);
      };
    }

    const script = document.createElement("script");
    script.src = PICKER_SCRIPT_SRC;
    script.async = true;
    script.onload = initPicker;
    script.onerror = () => {
      console.error("Google Picker API の読み込みに失敗しました。");
      script.remove();
      if (mounted.current) {
        setLoading(false);
        setError(new Error("Google Picker API の読み込みに失敗しました。"));
      }
    };
    document.head.appendChild(script);
  }, [initPicker, attempt]);

  const retry = useCallback(() => {
    if (pickerReady.current) return;
    setLoading(true);
    setError(null);
    setAttempt((prev) => prev + 1);
  }, []);

  const openFolderPicker = useCallback(
    (accessToken: string): Promise<{ id: string; name: string } | null> => {
      return new Promise((resolve) => {
        if (!pickerReady.current || !window.google?.picker) {
          console.warn("Google Picker API が読み込まれていません。");
          resolve(null);
          return;
        }

        const { picker } = window.google;
        const view = new picker.DocsView("folders").setParent("root");
        view.setSelectFolderEnabled(true);
        const pickerInstance = new picker.PickerBuilder()
          .addView(view)
          .setOAuthToken(accessToken)
          .setCallback((data: Record<string, unknown>) => {
            const action = data[picker.Response.ACTION];
            if (action === picker.Action.PICKED) {
              const docs = data[picker.Response.DOCS] as
                | Array<{ id: string; name: string }>
                | undefined;
              if (docs && docs.length > 0) {
                resolve({ id: docs[0].id, name: docs[0].name });
                return;
              }
            }
            resolve(null);
          })
          .build();

        pickerInstance.setVisible(true);
      });
    },
    [],
  );

  return { loading, error, retry, openFolderPicker };
}
