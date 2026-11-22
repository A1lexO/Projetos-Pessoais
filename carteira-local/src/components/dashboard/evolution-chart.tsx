"use client";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface EvolutionRow { date: string; carteira: number; cdi: number; ipca: number; ibov: number | null }

const fmtDate = (k: string) => k.split("-").reverse().join("/");
const fmtPct = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

export function EvolutionChart({ data, showIbov }: { data: EvolutionRow[]; showIbov: boolean }) {
  return (
    <div className="h-80 w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#232a36" strokeDasharray="3 3" />
          <XAxis dataKey="date" tickFormatter={(k: string) => k.slice(2, 7).split("-").reverse().join("/")} stroke="#64748b" fontSize={12} minTickGap={48} />
          <YAxis tickFormatter={fmtPct} stroke="#64748b" fontSize={12} width={56} />
          <Tooltip
            contentStyle={{ background: "#0f1218", border: "1px solid #232a36", borderRadius: 8 }}
            labelFormatter={(k) => fmtDate(String(k))}
            formatter={(v, name) => [`${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`, String(name)]}
          />
          <Legend />
          <Line type="monotone" dataKey="carteira" name="Carteira" stroke="#34d399" strokeWidth={2.5} dot={false} />
          <Line type="monotone" dataKey="cdi" name="CDI" stroke="#60a5fa" strokeWidth={1.5} dot={false} />
          <Line type="monotone" dataKey="ipca" name="IPCA" stroke="#fbbf24" strokeWidth={1.5} dot={false} />
          {showIbov && <Line type="monotone" dataKey="ibov" name="Ibovespa" stroke="#c084fc" strokeWidth={1.5} dot={false} />}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
