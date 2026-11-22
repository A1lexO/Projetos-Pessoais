"use client";
import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass, ghostButtonClass, inputClass } from "@/components/ui/card";
import { TYPE_LABELS } from "@/lib/format";

interface Props { id: string; type: string; date: string; quantity: number; unitPrice: number; fees: number; factor: number | null }

const F = (label: string, node: React.ReactNode) => <label className="block space-y-1"><span className="text-xs text-slate-400">{label}</span>{node}</label>;

export function EditButton(p: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [v, setV] = useState({ date: p.date, quantity: String(p.quantity), unitPrice: String(p.unitPrice), fees: String(p.fees), factor: p.factor ? String(p.factor) : "" });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  const isSwap = p.type === "TRANSFER_OUT";
  const hasFactor = p.type === "SPLIT" || p.type === "REVERSE_SPLIT" || isSwap;
  const hasPrice = !hasFactor && p.type !== "REGROUP";

  async function save() {
    setBusy(true); setErr(null);
    const res = await fetch(`/api/transactions/${p.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v) });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return setErr(data.error ?? "falha");
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button title="Editar" className="mr-2 text-slate-500 hover:text-accent" onClick={() => setOpen(true)}><Pencil size={15} /></button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md space-y-3 rounded-xl border border-surface-border bg-surface-raised p-5 text-left" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-medium">Editar · {TYPE_LABELS[p.type] ?? p.type}</h3>
            {F("Data", <input type="date" value={v.date} onChange={set("date")} className={inputClass} />)}
            {F(isSwap ? "Quantidade transferida (0 = toda a posição)" : "Quantidade", <input type="number" step="any" min="0" value={v.quantity} onChange={set("quantity")} className={inputClass} />)}
            {hasPrice && F("Preço unitário (R$)", <input type="number" step="any" min="0" value={v.unitPrice} onChange={set("unitPrice")} className={inputClass} />)}
            {p.type === "BUY" || p.type === "SELL" ? F("Custos (R$)", <input type="number" step="any" min="0" value={v.fees} onChange={set("fees")} className={inputClass} />) : null}
            {hasFactor && F(isSwap ? "Razão (destino ÷ origem)" : "Fator", <input type="number" step="any" min="0" value={v.factor} onChange={set("factor")} className={inputClass} />)}
            {err && <p className="text-sm text-negative">{err}</p>}
            <div className="flex gap-2 pt-1">
              <button className={buttonClass} disabled={busy} onClick={save}>{busy ? "Salvando…" : "Salvar e recalcular"}</button>
              <button className={ghostButtonClass} onClick={() => setOpen(false)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
