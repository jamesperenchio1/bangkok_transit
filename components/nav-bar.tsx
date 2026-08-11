"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useLanguage } from "@/components/language-provider";

/**
 * Deliberately thin. The map is the page, so the chrome takes one row and gets
 * out of the way — three destinations, language, theme.
 */
export function NavBar() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const { t, toggleLanguage, language } = useLanguage();

  const items = [
    { href: "/", label: t("routeMap") },
    { href: "/route", label: t("route") },
    { href: "/map", label: t("liveMap") },
  ];

  return (
    <header className="z-40 flex h-12 shrink-0 items-center gap-1 border-b bg-background px-3 sm:px-4">
      <Link href="/" className="mr-1 flex items-center gap-2 font-semibold tracking-tight">
        {/* The Sukhumvit green, so the mark belongs to the network it describes. */}
        <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-[#7AB420] text-[9px] font-semibold text-white">
          BTS
        </span>
        <span className="hidden text-sm sm:inline">{t("appName")}</span>
      </Link>

      <nav className="flex items-center gap-0.5">
        {items.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`rounded-md px-2.5 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)] ${
                active
                  ? "font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="ml-auto flex items-center gap-0.5">
        <button
          type="button"
          onClick={toggleLanguage}
          aria-label={language === "en" ? "เปลี่ยนเป็นภาษาไทย" : "Switch to English"}
          className="rounded-md px-2 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]"
        >
          {language === "en" ? "ไทย" : "EN"}
        </button>
        <button
          type="button"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label={t("darkMode")}
          className="rounded-md p-2 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]"
        >
          <Sun className="h-4 w-4 dark:hidden" />
          <Moon className="hidden h-4 w-4 dark:block" />
        </button>
      </div>
    </header>
  );
}
