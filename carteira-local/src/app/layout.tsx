import type { Metadata } from "next";
import { Nav } from "@/components/ui/nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Carteira Local",
  description: "Consolidação e análise pessoal de investimentos",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="dark">
      <body>
        <Nav />
        <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
