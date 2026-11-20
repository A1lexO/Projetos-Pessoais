import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Carteira Local",
  description: "Consolidação e análise pessoal de investimentos",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="dark">
      <body>{children}</body>
    </html>
  );
}
