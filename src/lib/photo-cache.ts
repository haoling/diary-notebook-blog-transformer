"use client";

/**
 * 取り込んだ写真のサムネイル画像を IndexedDB にキャッシュする。
 * Google Photos の baseUrl / Picker セッションは有効期限があり、
 * 毎回 API を叩き直すのはコストが高く、期限切れで表示できなくなることもあるため、
 * 一度取得したサムネイルはブラウザ内に保存して再利用する。
 */

const DB_NAME = "photo-thumbnail-cache";
const DB_VERSION = 1;
const STORE_NAME = "thumbnails";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("indexedDB is not available"));
  }
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch((err) => {
      // 開けなかった場合は次回呼び出しでリトライできるようキャッシュをリセットする
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

/** キャッシュ済みのサムネイル Blob を取得する。未キャッシュ・取得失敗時は null。 */
export async function getCachedPhotoThumbnail(id: string): Promise<Blob | null> {
  try {
    const db = await openDb();
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

/** サムネイル Blob をキャッシュに保存する。失敗しても呼び出し側の処理は継続してよい。 */
export async function setCachedPhotoThumbnail(id: string, blob: Blob): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(blob, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // キャッシュへの保存に失敗しても致命的ではないため無視する
  }
}

/** 写真削除時などにキャッシュ済みサムネイルを破棄する。 */
export async function deleteCachedPhotoThumbnail(id: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}
