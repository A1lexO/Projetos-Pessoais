"use client";
import clsx from "clsx";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass, inputClass } from "@/components/ui/card";

type Tab = "RV" | "RF" | "PROV" | "DESD" | "TROCA" | "FRAC" | "REDUC";
const TABS: { id: Tab; label: string }[] = [
  { id: "RV", label: "Renda variável" }, { id: "RF", label: "Renda fixa" }, { id: "PROV", label: "Provento" }, { id: "DESD", label: "Desdobramento" },
  { id: "TROCA", label: "Troca de ticker" }, { id: "FRAC", label: "Baixa de fração" },
  { id: "REDUC", label: "Redução de custo" },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-1"><span className="text-xs text-slate-400">{label}</span>{children}</label>;
}

export function ManualForm() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("RV");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = Object.fromEntries(new FormData(form)) as Record<string, unknown>;
    let url = "/api/transactions";
    if (tab === "RV") fd.kind = "RENDA_VARIAVEL";
    if (tab === "RF") { fd.kind = "RENDA_FIXA"; fd.isTaxExempt = fd.isTaxExempt === "on"; }
    if (tab === "DESD") fd.kind = "DESDOBRAMENTO";
    if (tab === "TROCA") fd.kind = "TROCA_TICKER";
    if (tab === "FRAC") fd.kind = "BAIXA_FRACAO";
    if (tab === "REDUC") fd.kind = "REDUCAO_CUSTO";
    if (tab === "PROV") url = "/api/proventos";
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fd) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "falha");
      setMsg({ ok: true, text: "Lançamento salvo e snapshots recalculados." });
      form.reset();
      router.refresh();
    } catch (err) { setMsg({ ok: false, text: err instanceof Error ? err.message : "erro" }); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => { setTab(t.id); setMsg(null); }}
            className={clsx("rounded-md px-3 py-1.5 text-sm", tab === t.id ? "bg-surface text-accent" : "text-slate-400 hover:text-slate-200")}>{t.label}</button>
        ))}
      </div>
      <form key={tab} onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        {tab === "RV" && (<>
          <Field label="Ativo (ticker)"><input name="ticker" required placeholder="PETR4" className={inputClass} /></Field>
          <Field label="Classe"><select name="assetClass" className={inputClass}><option value="ACAO">Ação</option><option value="FII">FII</option><option value="ETF">ETF</option><option value="BDR">BDR</option></select></Field>
          <Field label="Operação"><select name="type" className={inputClass}><option value="BUY">Compra</option><option value="SELL">Venda</option></select></Field>
          <Field label="Data"><input name="date" type="date" required defaultValue={today} className={inputClass} /></Field>
          <Field label="Quantidade"><input name="quantity" type="number" step="any" min="0" required className={inputClass} /></Field>
          <Field label="Preço unitário (R$)"><input name="unitPrice" type="number" step="any" min="0" required className={inputClass} /></Field>
          <Field label="Custos (R$)"><input name="fees" type="number" step="any" min="0" placeholder="0" className={inputClass} /></Field>
        </>)}
        {tab === "RF" && (<>
          <Field label="Nome do título"><input name="name" required placeholder="CDB Banco X 110% CDI 2028" className={inputClass} /></Field>
          <Field label="Tipo"><select name="assetClass" className={inputClass}><option value="RENDA_FIXA">CDB/LCI/LCA/Debênture</option><option value="TESOURO">Tesouro Direto</option></select></Field>
          <Field label="Indexador"><select name="indexer" className={inputClass}><option value="CDI_PERCENT">Pós-fixado (% do CDI)</option><option value="IPCA_SPREAD">IPCA + taxa</option><option value="PREFIXADO">Prefixado</option><option value="CDI_SPREAD">CDI + taxa</option><option value="SELIC">Selic + taxa</option></select></Field>
          <Field label="Taxa contratada (110 = 110% CDI; demais: % a.a.)"><input name="rate" type="number" step="any" min="0" required className={inputClass} /></Field>
          <Field label="Vencimento"><input name="maturityDate" type="date" required className={inputClass} /></Field>
          <Field label="Emissor (opcional)"><input name="issuer" className={inputClass} /></Field>
          <Field label="Movimento"><select name="type" className={inputClass}><option value="BUY">Aplicação</option><option value="RESGATE_TOTAL">Resgate total</option></select></Field>
          <Field label="Data"><input name="date" type="date" required defaultValue={today} className={inputClass} /></Field>
          <Field label="Valor (R$)"><input name="amount" type="number" step="any" min="0" required className={inputClass} /></Field>
          <label className="flex items-center gap-2 self-end text-sm text-slate-300"><input name="isTaxExempt" type="checkbox" /> Isento de IR</label>
          <p className="text-xs text-slate-500 sm:col-span-2">Para um título já cadastrado, as condições (taxa, vencimento) existentes são mantidas.</p>
        </>)}
        {tab === "PROV" && (<>
          <Field label="Ativo (ticker)"><input name="ticker" required placeholder="HGLG11" className={inputClass} /></Field>
          <Field label="Tipo"><select name="type" className={inputClass}><option value="DIVIDENDO">Dividendo</option><option value="JCP">JCP</option><option value="RENDIMENTO">Rendimento de FII</option><option value="AMORTIZACAO">Amortização</option></select></Field>
          <Field label="Data de pagamento"><input name="paymentDate" type="date" required defaultValue={today} className={inputClass} /></Field>
          <Field label="Data com (opcional)"><input name="comDate" type="date" className={inputClass} /></Field>
          <Field label="Valor bruto (R$)"><input name="grossAmount" type="number" step="any" min="0" required className={inputClass} /></Field>
          <Field label="IR retido (R$)"><input name="taxWithheld" type="number" step="any" min="0" placeholder="0" className={inputClass} /></Field>
          <Field label="Quantidade (opcional)"><input name="quantity" type="number" step="any" min="0" className={inputClass} /></Field>
        </>)}
        {tab === "DESD" && (<>
          <Field label="Ativo (ticker)"><input name="ticker" required placeholder="WEGE3" className={inputClass} /></Field>
          <Field label="Evento"><select name="type" className={inputClass}><option value="SPLIT">Desdobramento</option><option value="REVERSE_SPLIT">Grupamento</option></select></Field>
          <Field label="Data"><input name="date" type="date" required defaultValue={today} className={inputClass} /></Field>
          <Field label="Fator (2 = 1→2; 0,1 = 10→1)"><input name="factor" type="number" step="any" min="0" required className={inputClass} /></Field>
        </>)}
        {tab === "TROCA" && (<>
          <Field label="Ticker de origem (antigo / recibo)"><input name="fromTicker" required placeholder="PETZ3 ou KNSC12" className={inputClass} /></Field>
          <Field label="Ticker de destino (novo / principal)"><input name="toTicker" required placeholder="AUAU3 ou KNSC11" className={inputClass} /></Field>
          <Field label="Data do evento"><input name="date" type="date" required defaultValue={today} className={inputClass} /></Field>
          <Field label="Razão (destino ÷ origem; 1 = 1 para 1)"><input name="ratio" type="number" step="any" min="0" placeholder="1" className={inputClass} /></Field>
          <Field label="Quantidade (vazio = toda a posição)"><input name="quantity" type="number" step="any" min="0" className={inputClass} /></Field>
          <p className="text-xs text-slate-500 sm:col-span-2">Posição e custo médio passam ao destino; o ticker de origem fica inativo (sem consulta de cotações). Vale para troca de ticker, incorporação e conversão de recibo de subscrição.</p>
        </>)}
        {tab === "FRAC" && (<>
          <Field label="Ativo (ticker)"><input name="ticker" required placeholder="KLBN11" className={inputClass} /></Field>
          <Field label="Data"><input name="date" type="date" required defaultValue={today} className={inputClass} /></Field>
          <Field label="Quantidade (vazio = fração atual)"><input name="quantity" type="number" step="any" min="0" className={inputClass} /></Field>
          <Field label="Valor recebido no leilão (R$)"><input name="proceeds" type="number" step="any" min="0" placeholder="0" className={inputClass} /></Field>
        </>)}
        {tab === "REDUC" && (<>
          <Field label="Ativo que recebeu a incorporação (ticker)"><input name="ticker" required placeholder="AUAU3" className={inputClass} /></Field>
          <Field label="Data do recebimento"><input name="date" type="date" required defaultValue={today} className={inputClass} /></Field>
          <Field label="Valor recebido em dinheiro (R$)"><input name="amount" type="number" step="any" min="0" required placeholder="568,84" className={inputClass} /></Field>
          <Field label="Quantidade resgatada (opcional)"><input name="quantity" type="number" step="any" min="0" className={inputClass} /></Field>
          <p className="text-xs text-slate-500 sm:col-span-2">Resgate/amortização numa incorporação: o valor entra no caixa e abate o custo total do ativo. A quantidade não muda e o preço médio cai.</p>
        </>)}
        <div className="flex items-center gap-3 sm:col-span-2">
          <button className={buttonClass} disabled={busy}>{busy ? "Salvando…" : "Salvar lançamento"}</button>
          {msg && <span className={clsx("text-sm", msg.ok ? "text-accent" : "text-negative")}>{msg.text}</span>}
        </div>
      </form>
    </div>
  );
}
