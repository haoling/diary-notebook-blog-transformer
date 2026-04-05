/** Google Drive API エラーのベースクラス。 */
export class DriveError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "DriveError";
  }
}

/** 401 — アクセストークン失効。再認証が必要。 */
export class DriveAuthError extends DriveError {
  constructor(message?: string) {
    super(message ?? "アクセストークンが失効しました。再ログインしてください。", 401);
    this.name = "DriveAuthError";
  }
}

/** 403 — 権限不足。 */
export class DrivePermissionError extends DriveError {
  constructor(message?: string) {
    super(message ?? "このリソースへのアクセス権限がありません。", 403);
    this.name = "DrivePermissionError";
  }
}

/** 404 — リソースが見つからない。 */
export class DriveNotFoundError extends DriveError {
  constructor(message?: string) {
    super(message ?? "指定されたファイルが見つかりません。", 404);
    this.name = "DriveNotFoundError";
  }
}

/** 429 / 403 (rateLimit) — API クォータ超過。 */
export class DriveQuotaExceededError extends DriveError {
  constructor(
    message?: string,
    statusCode?: number,
  ) {
    super(message ?? "API のリクエスト制限に達しました。しばらく時間をおいてください。", statusCode ?? 429);
    this.name = "DriveQuotaExceededError";
  }
}

/** Drive API レスポンスから適切なエラーオブジェクトを生成する。 */
export function parseDriveError(status: number, body: unknown): DriveError {
  const error =
    typeof body === "object" && body !== null && "error" in body
      ? (body as {
          error?: {
            message?: string;
            errors?: Array<{ reason?: string }>;
          };
        }).error
      : undefined;

  const detail = error?.message;
  const reasons = Array.isArray(error?.errors)
    ? error.errors
        .map((entry) => entry?.reason)
        .filter((reason): reason is string => typeof reason === "string")
    : [];
  const isQuotaExceededReason = reasons.some((reason) =>
    ["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded"].includes(reason),
  );

  if (status === 401) return new DriveAuthError(detail);
  if (status === 403) {
    if (
      isQuotaExceededReason ||
      (typeof detail === "string" && detail.toLowerCase().includes("rate limit"))
    ) {
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
