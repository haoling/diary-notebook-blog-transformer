import { describe, expect, it } from "vitest";
import {
  DriveAuthError,
  DriveError,
  DriveNotFoundError,
  DrivePermissionError,
  DriveQuotaExceededError,
  parseDriveError,
} from "./drive-errors";

describe("parseDriveError", () => {
  it("401 は DriveAuthError になる", () => {
    const err = parseDriveError(401, undefined);
    expect(err).toBeInstanceOf(DriveAuthError);
    expect(err.statusCode).toBe(401);
  });

  it("404 は DriveNotFoundError になる", () => {
    expect(parseDriveError(404, {})).toBeInstanceOf(DriveNotFoundError);
  });

  it("429 は DriveQuotaExceededError になる", () => {
    const err = parseDriveError(429, {});
    expect(err).toBeInstanceOf(DriveQuotaExceededError);
    expect(err.statusCode).toBe(429);
  });

  it("403 は通常 DrivePermissionError になる", () => {
    const err = parseDriveError(403, { error: { message: "forbidden" } });
    expect(err).toBeInstanceOf(DrivePermissionError);
    expect(err.message).toBe("forbidden");
  });

  it.each(["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded"])(
    "403 で reason が %s なら DriveQuotaExceededError になる（ステータスは 403 を保持）",
    (reason) => {
      const err = parseDriveError(403, { error: { message: "x", errors: [{ reason }] } });
      expect(err).toBeInstanceOf(DriveQuotaExceededError);
      expect(err.statusCode).toBe(403);
    },
  );

  it("403 でメッセージに rate limit を含む場合（大文字小文字無視）は DriveQuotaExceededError になる", () => {
    const err = parseDriveError(403, { error: { message: "User Rate Limit Exceeded" } });
    expect(err).toBeInstanceOf(DriveQuotaExceededError);
  });

  it("その他のステータスは DriveError になり、メッセージ未指定なら HTTP ステータスを含む", () => {
    const err = parseDriveError(500, null);
    expect(err).toBeInstanceOf(DriveError);
    expect(err.constructor).toBe(DriveError);
    expect(err.statusCode).toBe(500);
    expect(err.message).toContain("500");
  });

  it("その他のステータスでも API のメッセージがあれば優先する", () => {
    expect(parseDriveError(500, { error: { message: "boom" } }).message).toBe("boom");
  });

  it("メッセージ未指定の場合は各エラーの既定メッセージが使われる", () => {
    expect(parseDriveError(401, {}).message).toContain("再ログイン");
    expect(parseDriveError(404, {}).message).toContain("見つかりません");
  });

  it("errors が配列でない・reason が文字列でない不正なボディでも例外を投げない", () => {
    expect(parseDriveError(403, { error: { errors: "oops" } })).toBeInstanceOf(DrivePermissionError);
    expect(parseDriveError(403, { error: { errors: [{ reason: 1 }, null] } })).toBeInstanceOf(
      DrivePermissionError,
    );
  });

  it("すべてのエラーは Error のサブクラスで name が設定される", () => {
    expect(new DriveAuthError().name).toBe("DriveAuthError");
    expect(new DrivePermissionError().name).toBe("DrivePermissionError");
    expect(new DriveNotFoundError().name).toBe("DriveNotFoundError");
    expect(new DriveQuotaExceededError().name).toBe("DriveQuotaExceededError");
    expect(new DriveAuthError()).toBeInstanceOf(Error);
  });
});
