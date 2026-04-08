import { EditArticleContent } from "./EditArticleContent";

export function generateStaticParams() {
  return [{ id: "_" }];
}

export default function EditArticlePage() {
  return <EditArticleContent />;
}
