/** Google Drive API エラーのベースクラス。 */
export class DriveError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "DriveError";
  }
}

/** 401 — アクセストークン失効。再認証が必要。 */
export class DriveAuthError extends DriveError {
  constructor(message = "アクセストークンが失効しました。再ログインしてください。") {
    super(message, 401);
    this.name = "DriveAuthError";
  }
}

/** 403 — 権限不足。 */
export class DrivePermissionError extends DriveError {
  constructor(message = "このリソースへのアクセス権限がありません。") {
    super(message, 403);
    this.name = "DrivePermissionError";
  }
}

/** 404 — リソースが見つからない。 */
export class DriveNotFoundError extends DriveError {
  constructor(message = "指定されたファイルが見つかりません。") {
    super(message, 404);
    this.name = "DriveNotFoundError";
  }
}

/** 429 / 403 (rateLimit) — API クォータ超過。 */
export class DriveQuotaExceededError extends DriveError {
  constructor(
    message = "API のリクエスト制限に達しました。しばらく時間をおいてください。",
    statusCode?: number,
  ) {
    super(message, statusCode ?? 429);
    this.name = "DriveQuotaExceededError";
  }
}

/** Drive API レスポンスから適切なエラーオブジェクトを生成する。 */
export function parseDriveError(status: number, body: unknown): DriveError {
  const detail =
    typeof body === "object" && body !== null && "error" in body
      ? (body as { error: { message?: string } }).error?.message
      : undefined;

  if (status === 401) return new DriveAuthError(detail);
  if (status === 403) {
    if (typeof detail === "string" && detail.toLowerCase().includes("rate limit")) {
      return new DriveQuotaExceededError(detail, status);
    }
    return new DrivePermissionError(detail);
  }
  if (status === 404) return new DriveNotFoundError(detail);
  if (status === 429) return new DriveQuotaExceededError(detail);

  return new DriveError(
    detail ?? `Drive API エラー (HTTP ${status})`,
    status,
  );
}
