"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass, inputClass } from "@/components/ui/card";

const today = () => new Date().toISOString().slice(0, 10);

async function post(body: Record<string, unknown>): Promise<string | null> {
  const res = await fetch("/api/transactions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  return res.ok ? null : data.error ?? "falha";
}

function Row({ children, action, label }: { children: React.ReactNode; label: string; action: () => Promise<string | null> }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <li className="flex flex-wrap items-end gap-3 py-3">
      {children}
      <button className={buttonClass} disabled={busy} onClick={async () => { setBusy(true); const e = await action(); setBusy(false); setErr(e); if (!e) router.refresh(); }}>
        {busy ? "Aplicando…" : label}
      </button>
      {err && <span className="text-sm text-negative">{err}</span>}
    </li>
  );
}

export function FractionRow({ ticker, fraction, quantity }: { ticker: string; fraction: number; quantity: number }) {
  const [date, setDate] = useState(today());
  const [proceeds, setProceeds] = useState("");
  return (
    <Row label="Baixar fração" action={() => post({ kind: "BAIXA_FRACAO", ticker, date, quantity: fraction, proceeds: proceeds || 0 })}>
      <div className="min-w-40"><div className="font-medium">{ticker}</div><div className="text-xs text-slate-400">saldo {quantity} · fração {fraction}</div></div>
      <label className="text-xs text-slate-400">Data<input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${inputClass} mt-1`} /></label>
      <label className="text-xs text-slate-400">Valor recebido (R$)<input type="number" step="any" min="0" placeholder="0" value={proceeds} onChange={(e) => setProceeds(e.target.value)} className={`${inputClass} mt-1 w-32`} /></label>
    </Row>
  );
}

export function SwapRow({ from, to, quantity, note }: { from: string; to: string; quantity: number; note?: string }) {
  const [target, setTarget] = useState(to);
  const [ratio, setRatio] = useState("1");
  const [date, setDate] = useState(today());
  return (
    <Row label="Trocar ticker" action={() => post({ kind: "TROCA_TICKER", fromTicker: from, toTicker: target, date, ratio })}>
      <div className="min-w-40"><div className="font-medium">{from}</div><div className="text-xs text-slate-400">{quantity} un. {note ? `· ${note}` : ""}</div></div>
      <label className="text-xs text-slate-400">Novo ticker<input value={target} onChange={(e) => setTarget(e.target.value.toUpperCase())} placeholder="NOVO3" className={`${inputClass} mt-1 w-32`} /></label>
      <label className="text-xs text-slate-400">Razão<input type="number" step="any" min="0" value={ratio} onChange={(e) => setRatio(e.target.value)} className={`${inputClass} mt-1 w-24`} /></label>
      <label className="text-xs text-slate-400">Data<input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${inputClass} mt-1`} /></label>
    </Row>
  );
}
