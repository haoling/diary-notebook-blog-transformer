// NOTE:
// Static export モードでは generateStaticParams で列挙されたパスのみが生成される。
// 実データの ID はビルド時に不明なため、ダミーパス `/sessions/_` のみを生成している。
// クライアントサイドナビゲーション経由では任意の `/sessions/<id>` にアクセス可能だが、
// 直URL アクセス・リロード時は 404 になる制約がある。
import { SessionDetailContent } from "./SessionDetailContent";

export function generateStaticParams() {
  return [{ id: "_" }];
}

export default function SessionDetailPage() {
  return <SessionDetailContent />;
}
