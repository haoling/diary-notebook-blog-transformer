import { SessionDetailContent } from "./SessionDetailContent";

export function generateStaticParams() {
  return [{ id: "_" }];
}

export default function SessionDetailPage() {
  return <SessionDetailContent />;
}
