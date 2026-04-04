import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Diary Notebook Blog Transformer",
  description: "システム手帳・ノートの手書きページをスキャン・OCR し、写真と組み合わせてブログ記事として公開する",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
