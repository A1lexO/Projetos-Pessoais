# Arquitetura — Carteira Local

Aplicação pessoal de consolidação e análise de investimentos. 100% local: Next.js + SQLite, sem contas, sem open banking, sem recomendações.

## 1. Stack

| Camada | Tecnologia |
|---|---|
| Framework | Next.js 15 (App Router) + TypeScript estrito |
| UI | Tailwind CSS 3 (dark mode por padrão, classe `dark` no `<html>`), Recharts, Lucide |
| Banco | SQLite via Prisma ORM (arquivo `prisma/dev.db`) |
| Validação | Zod (formulários, API e linhas importadas) |
| Parsing | `xlsx` (Excel da B3) e `papaparse` (CSV) |

## 2. Estrutura de pastas

```
carteira-local/
├── prisma/
│   ├── schema.prisma          # modelo de dados
│   └── dev.db                 # SQLite local (ignorado no git)
├── docs/
│   └── ARQUITETURA.md
├── data/                      # uploads temporários, backups (ignorado no git)
├── src/
│   ├── app/                   # rotas (App Router)
│   │   ├── page.tsx           # Dashboard Geral
│   │   ├── ativos/            # Meus Ativos
│   │   ├── lancamentos/       # Lançamentos & Importação
│   │   └── api/               # Route Handlers (import, sync de benchmarks, CRUD)
│   ├── components/
│   │   ├── ui/                # primitivos (Card, Button, Table, Badge…)
│   │   ├── dashboard/         # cards de resumo, gráficos
│   │   ├── ativos/            # tabela filtrável
│   │   └── lancamentos/       # formulário, histórico, dropzone
│   ├── lib/
│   │   ├── db/                # cliente Prisma singleton
│   │   ├── finance/           # MOTOR DE CÁLCULO (funções puras, testáveis)
│   │   │   ├── constants.ts   # domínios (classes, tipos, indexadores)
│   │   │   ├── average-price.ts   # preço médio  (Etapa 2)
│   │   │   ├── positions.ts       # posição por ativo/dia  (Etapa 2)
│   │   │   ├── twr.ts             # cota diária / TWR  (Etapa 2)
│   │   │   ├── fixed-income.ts    # marcação de renda fixa  (Etapa 2)
│   │   │   └── proventos.ts       # proventos mensais/acum., YoC  (Etapa 2)
│   │   ├── benchmarks/        # cliente API SGS (BCB) + cache em SQLite
│   │   ├── import/            # parsers B3 (posição, movimentações, negociação)
│   │   └── validation/        # schemas Zod
│   └── types/
└── .env                       # DATABASE_URL="file:./dev.db"
```

Princípio: **`lib/finance` é puro** (sem I/O, sem Prisma). Recebe arrays de transações/cotações e devolve séries. As rotas e Server Components fazem o I/O e chamam o motor. Isso permite testar o cálculo isoladamente.

## 3. Modelo de dados (resumo)

- **Asset** + **FixedIncomeTerms** (1:1): cadastro do ativo; renda fixa guarda indexador, taxa contratada e vencimento.
- **Transaction**: livro de operações (compra, venda, desdobramento, grupamento, bonificação, vencimento, amortização). `@@unique([source, externalId])` evita duplicar linhas ao reimportar a mesma planilha.
- **Provento**: dividendos, JCP e rendimentos de FII (bruto, IR e líquido).
- **ImportBatch**: auditoria de cada upload; permite desfazer um lote inteiro.
- **PriceQuote**: cotação de fechamento por ativo/dia.
- **Benchmark** / **BenchmarkValue**: CDI (SGS 12, taxa % a.d.), IPCA (SGS 433, % mensal), SELIC (SGS 11) e IBOV (nível do índice, fonte externa a definir; o SGS não o cobre).
- **PortfolioSnapshot** / **PositionSnapshot**: cache derivado do motor (a cota diária e a posição por dia). Pode ser apagado e recalculado.

Fonte da verdade = `Transaction`, `Provento`, `PriceQuote`, `Benchmark*`. Todo o resto é derivado.

## 4. Cota diária (TWR) sem distorção por aportes

### 4.1 Definições

Para cada dia útil `t`:

- `V_t` = valor total da carteira no fechamento = valor de mercado das posições + proventos líquidos acumulados (mantidos como "caixa de proventos" dentro da carteira, para que o rendimento entre no retorno).
- `F_t` = fluxo externo líquido do dia = Σ compras (valor + custos) − Σ vendas (valor − custos). Compra é aporte (`F > 0`), venda é resgate (`F < 0`). Proventos **não** são fluxo externo: são retorno.
- `r_t` = retorno do dia.

### 4.2 Retorno diário (fluxo no início do dia)

Assume-se que o fluxo do dia entra na carteira antes de o dia render:

```
            V_t
r_t  =  ───────────── − 1          se (V_{t-1} + F_t) > 0
         V_{t-1} + F_t

r_t  =  0                          caso contrário (carteira vazia)
```

Por que no início do dia: a operação ocorre durante o pregão e é avaliada ao fechamento; incluir `F_t` no denominador captura corretamente o ganho/perda intradiário da posição nova sem inflar o retorno quando o patrimônio anterior é pequeno.

### 4.3 Cota

```
Cota_base = 100                    (valor antes do primeiro aporte)
Cota_t = Cota_{t-1} × (1 + r_t)    (o 1º dia já aplica r_t: ganho/perda intradiário do aporte inicial)
```

A cota só se move por rentabilidade. Um aporte de R$ 50 mil aumenta `V_t` e `F_t` na mesma medida, então `r_t` não muda e o gráfico não tem "degrau".

### 4.4 Rentabilidade em uma janela `[a, b]`

```
R_carteira(a,b) = Cota_b / Cota_a − 1
```

A janela usa o fechamento anterior à data inicial como base (`Cota_a` = cota do último dia útil antes do início). Janelas: 1M, 6M, YTD, 12M e Tudo.

### 4.5 Índice dos benchmarks

**CDI** (taxa % ao dia, SGS 12):

```
Idx_CDI_t = Idx_CDI_{t-1} × (1 + cdi_t / 100)
R_CDI(a,b) = Idx_CDI_b / Idx_CDI_a − 1
```

**IPCA** (variação mensal, SGS 433): composta por mês. Para janelas que não começam no dia 1º, interpola-se pro rata por dias corridos dentro do mês (convenção a documentar na Etapa 2).

**Ibovespa**: `R_IBOV(a,b) = Nivel_b / Nivel_a − 1`.

### 4.6 Comparação com o CDI

Todas as curvas são rebaseadas em 100 na data inicial da janela:

```
Serie_X_t = 100 × Idx_X_t / Idx_X_a       (X = carteira, CDI, IPCA, IBOV)
```

Rentabilidade relativa:

```
%CDI = R_carteira / R_CDI × 100           (exibida só se R_CDI > 0)
```

Exemplo: carteira +12,4% e CDI +10,8% no período → `114,8% do CDI`.

### 4.7 IPCA + X (retorno real)

```
R_real(a,b) = (1 + R_carteira) / (1 + R_IPCA) − 1

X (% a.a.) = (1 + R_real)^(365 / dias_corridos) − 1
```

Exemplo: "IPCA + 6,2%". Janelas menores que ~3 meses anualizam com ruído; a tela deve sinalizar isso.

### 4.8 Pontos de atenção

1. **Dias sem cotação**: carrega-se a última cotação conhecida (forward fill). Ativo sem nenhuma cotação usa o preço médio e é sinalizado.
2. **Eventos corporativos**: desdobramentos, grupamentos e bonificações ajustam quantidade e preço médio, nunca geram fluxo.
3. **Renda fixa**: marcada na curva (valor aplicado acrescido da taxa contratada e do indexador: % do CDI, IPCA + spread ou prefixado), usando as séries em cache. Marcação a mercado do Tesouro pode vir depois.
4. **Reprodutibilidade**: o motor é determinístico. `PortfolioSnapshot` é apenas cache; recalcular a partir do livro de transações deve dar o mesmo resultado.

## 5. Preço médio

Compra: `PM_novo = (Qtd × PM + QtdCompra × PrecoCompra + Custos) / (Qtd + QtdCompra)`.
Venda: quantidade cai, **PM não muda**, e o resultado realizado é `(PrecoVenda − PM) × QtdVenda − Custos`.
Desdobramento por fator `k`: `Qtd × k`, `PM / k`. Bonificação: nova quantidade com custo atribuído conforme o comunicado.

## 6. Proventos e Yield on Cost

```
Proventos do mês  = Σ netAmount com paymentDate no mês
Proventos acumulados = Σ netAmount até a data
YoC (ativo)  = proventos líquidos dos últimos 12 meses / custo total da posição (PM × Qtd)
YoC (carteira) = proventos líquidos 12M / custo total da carteira
```

## 7. Importação da B3

Fluxo: upload → detecção do tipo de arquivo pelo cabeçalho → parser específico → normalização → pré-visualização → confirmação → gravação com `ImportBatch`. Cada linha gera um `externalId` (hash de data, ticker, tipo, quantidade, preço, instituição) para deduplicar. Linhas com erro vão para o `errorLog` do lote sem derrubar a importação inteira. Os layouts reais dos arquivos da Área do Investidor devem ser validados com uma amostra sua antes de fechar o mapeamento de colunas.

## 8. Decisões e trade-offs

- **Float em vez de Decimal**: o SQLite do Prisma não tem decimal exato. Para uso pessoal o erro é desprezível; arredondamos só na exibição.
- **Strings no lugar de enums**: portabilidade entre versões do Prisma/SQLite. Zod garante o domínio na entrada.
- **Cálculo sob demanda + cache**: simples e correto primeiro; otimizar com snapshots só se ficar lento.
- **Sem autenticação**: app roda em `localhost`, usuário único.
- **IBOV**: o SGS do BCB não fornece o índice. A estrutura existe; a fonte (CSV manual ou provedor) fica para decidir.

## 9. Roadmap

- **Etapa 1**: estrutura base, schema, documentação. ✅
- **Etapa 2**: motor de cálculo, sync de benchmarks e cotações, seed. ✅ (ver seção 10)
- **Etapa 3**: importador B3 (config de colunas isolada) e telas (Dashboard, Meus Ativos, Lançamentos).

## 10. Etapa 2 — o que foi implementado

### 10.1 Fluxo de dados

```
Yahoo (.SA, ^BVSP)  ─┐                       ┌─> PositionSnapshot (por ativo/dia)
SGS BCB (12/11/433) ─┼─> SQLite (cache) ─> lib/finance (puro) ─┤
Lançamentos/Proventos┘                       └─> PortfolioSnapshot (cota diária)
```

`lib/services/snapshots.ts` carrega tudo do Prisma, chama `computePortfolio()` e regrava os snapshots. Nada em `lib/finance` toca banco ou rede.

### 10.2 Módulos do motor (`src/lib/finance`)

| Arquivo | Responsabilidade |
|---|---|
| `dates.ts` | datas como `YYYY-MM-DD`; calendário de dias úteis (feriados saem da própria série do CDI) |
| `average-price.ts` | PM e posição; venda não altera PM; desdobramento; bonificação |
| `splits.ts` | normaliza o livro na base de desdobramentos/grupamentos para casar com cotações do Yahoo |
| `fixed-income.ts` | índice de acumulação na curva: `CDI_PERCENT`, `CDI_SPREAD`, `IPCA_SPREAD`, `PREFIXADO`, `SELIC` |
| `positions.ts` | posição, valor e custo por ativo/dia; fluxos; resultado realizado |
| `twr.ts` | cota diária (fórmula da seção 4) |
| `portfolio.ts` | orquestra tudo e devolve séries + índices de CDI/IPCA/Selic alinhados |
| `compare.ts` | janelas (1M/6M/YTD/12M/Tudo), retorno de janela, rebase 100, % do CDI, IPCA+ |
| `proventos.ts` | proventos mensais/acumulados, 12 meses, Yield on Cost |

### 10.3 Convenções de cálculo

- **Renda fixa na curva**: cada compra é um lote que rende a partir do dia útil seguinte. Base de 252 dias úteis. Para de render no vencimento. Rentabilidade **bruta** (sem IR/IOF).
- **CDI/Selic**: taxa diária da série; dia sem dado (ex.: hoje) repete o último valor conhecido.
- **IPCA**: variação mensal distribuída por igual pelos dias úteis do mês. Mês ainda não divulgado é projetado com o último valor conhecido.
- **Cotações**: último fechamento até o dia (forward fill). Sem nenhuma cotação, usa o preço médio (`priceSource = COST`).
- **Desdobramentos**: o Yahoo ajusta o histórico retroativamente; por isso o motor reescreve compras/vendas anteriores ao evento (qtd × k, preço ÷ k). Bonificações **não** são ajustadas.
- **Proventos**: líquidos, acumulados como caixa dentro da carteira (entram no retorno, não são fluxo externo).
- **Dividendos não reinvestidos**: o caixa de proventos não rende CDI. Simplificação deliberada.

### 10.4 Comandos

```bash
npm install
npx prisma migrate dev --name init
npx prisma db seed               # carteira fictícia (dados sintéticos!)
npm run test                     # testes do motor (node:test, sem dependências)

npm run sync:benchmarks          # CDI, Selic, IPCA (SGS) + Ibovespa (Yahoo)  [-- --full]
npm run sync:quotes              # cotações dos ativos de renda variável      [-- --full] [-- PETR4]
npm run rebuild:snapshots        # recalcula cota e posições
```

O seed grava benchmarks e cotações **sintéticos**. Antes de usar dados reais: `npx prisma migrate reset`, depois os syncs e a importação.

### 10.5 Limitações conhecidas

- BRAPI não foi implementada; o Yahoo está atrás de `lib/quotes/yahoo.ts` e pode ser trocado.
- `yahoo-finance2` é API não oficial: pode quebrar ou limitar requisições.
- Sem marcação a mercado do Tesouro e sem IR/IOF na renda fixa.
- Eventos corporativos além de desdobramento/grupamento (bonificação, subscrição, incorporação) exigem lançamento manual.
