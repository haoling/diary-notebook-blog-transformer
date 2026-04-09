// NOTE:
// Static export モードでは generateStaticParams で列挙されたパスのみが生成される。
// 実データの ID はビルド時に不明なため、ダミーパス `/articles/_` のみを生成している。
// GitHub Pages の SPA フォールバック（404.html → index.html）により、
// 直接 URL アクセス・リロード時でもクライアントサイドルーターが正しく動作する。
// このフォールバックは build スクリプトで `cp out/index.html out/404.html` により実現している。
import { EditArticleContent } from "./EditArticleContent";

export function generateStaticParams() {
  return [{ id: "_" }];
}

export default function EditArticlePage() {
  return <EditArticleContent />;
}
