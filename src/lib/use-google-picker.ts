"use client";

import { useState, useEffect, useCallback, useRef } from "react";

/** Google Picker API の型宣言。 */
declare global {
  interface Window {
    google: {
      picker: {
        PickerBuilder: new () => PickerBuilder;
        ViewId: {
          FOLDERS: 1;
        };
        Action: {
          PICKED: "google.picker.Action.PICKED";
          CANCEL: "google.picker.Action.CANCEL";
        };
        Response: {
          ACTION: "google.picker.Response.ACTION";
          DOCUMENTS: "google.picker.Response.DOCUMENTS";
        };
        Document: {
          id: string;
          name: string;
        };
      };
    };
    gapi: {
      load: (api: string, callback: () => void) => void;
    };
  }
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
 * @returns openFolderPicker — フォルダ選択ダイアログを開き、選択結果を返す Promise
 */
export function useGooglePicker() {
  const [loading, setLoading] = useState(true);
  const pickerReady = useRef(false);
  const scriptLoading = useRef(false);

  const initPicker = useCallback(() => {
    window.gapi.load("picker", () => {
      pickerReady.current = true;
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (scriptLoading.current) return;
    scriptLoading.current = true;

    const existingScript = document.querySelector(
      `script[src="${PICKER_SCRIPT_SRC}"]`,
    );
    if (existingScript) {
      if (window.gapi) {
        initPicker();
      } else {
        existingScript.addEventListener("load", initPicker, { once: true });
      }
      return;
    }

    const script = document.createElement("script");
    script.src = PICKER_SCRIPT_SRC;
    script.async = true;
    script.onload = initPicker;
    script.onerror = () => {
      console.error("Google Picker API の読み込みに失敗しました。");
      setLoading(false);
    };
    document.head.appendChild(script);
  }, [initPicker]);

  const openFolderPicker = useCallback(
    (accessToken: string): Promise<{ id: string; name: string } | null> => {
      return new Promise((resolve) => {
        if (!pickerReady.current) {
          console.warn("Google Picker API が読み込まれていません。");
          resolve(null);
          return;
        }

        const picker = new window.google.picker.PickerBuilder()
          .addView(window.google.picker.ViewId.FOLDERS)
          .setOAuthToken(accessToken)
          .setCallback((data: Record<string, unknown>) => {
            const action = data[window.google.picker.Response.ACTION];
            if (action === window.google.picker.Action.PICKED) {
              const docs = data[
                window.google.picker.Response.DOCUMENTS
              ] as Array<{ id: string; name: string }> | undefined;
              if (docs && docs.length > 0) {
                resolve({ id: docs[0].id, name: docs[0].name });
                return;
              }
            }
            resolve(null);
          })
          .build();

        picker.setVisible(true);
      });
    },
    [],
  );

  return { loading, openFolderPicker };
}
