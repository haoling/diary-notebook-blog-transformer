"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

const navItems: NavItem[] = [
  { href: "/sessions", label: "セッション一覧", icon: "📓" },
  { href: "/photos", label: "写真インポート", icon: "🖼️" },
  { href: "/articles/new", label: "記事を作成", icon: "✏️" },
  { href: "/settings", label: "設定", icon: "⚙️" },
];

export function Navigation() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1">
      {navItems.map((item) => {
        const isActive =
          item.href === "/sessions"
            ? pathname === "/sessions" || pathname.startsWith("/sessions/")
            : pathname === item.href;

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-label={item.label}
            aria-current={isActive ? "page" : undefined}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              isActive
                ? "bg-slate-800 text-white"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-800"
            }`}
          >
            <span>{item.icon}</span>
            <span className="hidden sm:inline">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
