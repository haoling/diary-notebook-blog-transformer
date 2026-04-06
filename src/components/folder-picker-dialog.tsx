"use client";

import { useState } from "react";
import { useGooglePicker } from "@/lib/use-google-picker";

type FolderInfo = { id: string; name: string };

type FolderPickerDialogProps = {
  accessToken: string;
  onSelect: (folder: FolderInfo) => void;
  onCancel: () => void;
};

/**
 * 初期化時にユーザーにフォルダ選択を促すダイアログコンポーネント。
 *
 * Google Picker API を使って手帳画像の保存先フォルダを選択させる。
 */
export const FolderPickerDialog = ({
  accessToken,
  onSelect,
  onCancel,
}: FolderPickerDialogProps) => {
  const { loading, openFolderPicker } = useGooglePicker();
  const [selectedFolder, setSelectedFolder] = useState<FolderInfo | null>(null);
  const [picking, setPicking] = useState(false);

  const handleOpenPicker = async () => {
    setPicking(true);
    try {
      const result = await openFolderPicker(accessToken);
      if (result) {
        setSelectedFolder(result);
      }
    } finally {
      setPicking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-2 text-lg font-semibold text-gray-900">
          フォルダの選択
        </h2>
        <p className="mb-6 text-sm text-gray-600">
          手帳のスキャン画像を保存するフォルダを選択してください。
        </p>

        {selectedFolder ? (
          <div className="mb-6">
            <p className="mb-1 text-sm font-medium text-gray-700">
              選択されたフォルダ:
            </p>
            <p className="rounded-md bg-gray-100 px-3 py-2 text-sm text-gray-900">
              {selectedFolder.name}
            </p>
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            キャンセル
          </button>
          {!selectedFolder ? (
            <button
              type="button"
              onClick={handleOpenPicker}
              disabled={loading || picking}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? "読み込み中…" : picking ? "選択中…" : "フォルダを選択する"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onSelect(selectedFolder)}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              このフォルダを使用する
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
