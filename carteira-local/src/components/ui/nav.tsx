"use client";
import clsx from "clsx";
import { LayoutDashboard, ListChecks, ReceiptText, Scale } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/ativos", label: "Meus Ativos", icon: ListChecks },
  { href: "/lancamentos", label: "Lançamentos", icon: ReceiptText },
  { href: "/conferencia", label: "Conferência", icon: Scale },
];

export function Nav() {
  const path = usePathname();
  return (
    <header className="border-b border-surface-border bg-surface-raised/60 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
        <span className="font-semibold text-accent">Carteira Local</span>
        <nav className="flex gap-1">
          {items.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? path === "/" : path.startsWith(href);
            return (
              <Link key={href} href={href} className={clsx("flex items-center gap-2 rounded-md px-3 py-1.5 text-sm", active ? "bg-surface text-slate-100" : "text-slate-400 hover:text-slate-200")}>
                <Icon size={16} /> {label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
