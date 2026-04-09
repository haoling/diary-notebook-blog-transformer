"use client";

import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";

type ScannerUploadModuleProps = {
  onUpload: (blob: Blob, fileName: string) => Promise<void>;
  disabled?: boolean;
};

const ACCEPTED_TYPES: Record<string, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
};

/**
 * ファイルアップロードで画像を取り込むコンポーネント。
 *
 * react-dropzone を使用してドラッグ&ドロップまたはファイル選択で
 * 画像をアップロードする。
 */
export const ScannerUploadModule = ({
  onUpload,
  disabled = false,
}: ScannerUploadModuleProps) => {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      setUploading(true);
      setError(null);
      for (const file of acceptedFiles) {
        try {
          const blob = new Blob([file], { type: file.type });
          await onUpload(blob, file.name);
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "アップロードに失敗しました。",
          );
          break;
        }
      }
      setUploading(false);
    },
    [onUpload],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_TYPES,
    multiple: true,
    disabled: disabled || uploading,
  });

  return (
    <div>
      <div
        {...getRootProps()}
        className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors cursor-pointer ${
          isDragActive
            ? "border-blue-500 bg-blue-50"
            : "border-slate-300 hover:border-slate-400 hover:bg-slate-50"
        } ${disabled || uploading ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        <input {...getInputProps()} />
        <div className="text-center">
          <div className="text-2xl mb-2">📁</div>
          {uploading ? (
            <p className="text-sm text-slate-500">アップロード中...</p>
          ) : isDragActive ? (
            <p className="text-sm text-blue-600">ここにドロップ...</p>
          ) : (
            <>
              <p className="text-sm font-medium text-slate-700">
                画像をドラッグ&ドロップ
              </p>
              <p className="text-xs text-slate-400 mt-1">
                またはクリックしてファイルを選択（JPG, PNG, WebP）
              </p>
            </>
          )}
        </div>
      </div>
      {error && (
        <p className="mt-2 text-sm text-red-600">{error}</p>
      )}
    </div>
  );
};
