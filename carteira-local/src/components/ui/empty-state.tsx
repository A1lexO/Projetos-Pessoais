import Link from "next/link";
import { Card } from "./card";

export function EmptyState() {
  return (
    <Card title="Nenhum dado calculado ainda">
      <p className="text-sm text-slate-400">
        Para ver o dashboard: rode <code className="rounded bg-surface px-1.5 py-0.5">npx prisma db seed</code> (carteira fictícia) ou importe suas
        planilhas em <Link href="/lancamentos" className="text-accent underline">Lançamentos</Link> e clique em “Recalcular”.
      </p>
    </Card>
  );
}
