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
2. **Eventos corporativos**: desdobramentos, grupamentos, bonificações, trocas de ticker e conversões de recibo ajustam quantidade e preço médio, nunca geram fluxo (ver seção 13).
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
- **Etapa 3**: importador B3 e telas (Dashboard, Meus Ativos, Lançamentos). ✅ (ver seção 11)

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
- **Desdobramentos**: o livro fica em termos reais (como negociado). O Yahoo ajusta o histórico retroativamente; por isso, ao valorizar um dia, o motor devolve a cotação à base negociada multiplicando pelos fatores dos desdobramentos/grupamentos posteriores do livro. Bonificações **não** geram ajuste de cotação.
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

- Cotações: ver seção 12 (provedores com fallback).
- Sem marcação a mercado do Tesouro e sem IR/IOF na renda fixa.
- Eventos corporativos além de desdobramento/grupamento (bonificação, subscrição, incorporação) exigem lançamento manual.

## 11. Etapa 3 — importador B3 e telas

### 11.1 Importador (`src/lib/import`, config em `src/config/b3-columns.ts`)

Fluxo: upload → `readTable` (xlsx/csv) → `detectKind` pelos cabeçalhos → `parseB3Rows` → **prévia** (consulta o banco, nada é gravado) → confirmação → gravação em um `ImportBatch`.

- **Mapeamento isolado**: nomes de colunas, tipos de movimentação e opções ficam só em `b3-columns.ts`. Aliases são comparados sem acento e sem diferença de caixa.
- **Deduplicação**: `externalId = sha1(origem, data, tipo, ativo, qtd, preço, instituição, n)`, em que `n` é a ocorrência da linha idêntica dentro do arquivo. Reimportar o mesmo arquivo gera os mesmos hashes e as linhas são ignoradas. Duas execuções idênticas legítimas no mesmo dia continuam distintas.
- **Negociação x Movimentação**: compras/vendas aparecem nas duas planilhas. Por padrão, a Movimentação só traz proventos e desdobramentos/bonificações; negócios vêm da Negociação. Se você só tem a Movimentação, ligue `importTradesFromMovimentacao`.
- **Ignorado com motivo**: opções/termo/futuro, renda fixa (cadastro manual), grupamento, leilão de fração, transferência de custódia.
- **Alertas**: classe presumida (ticker `11` sem texto de produto), primeira operação de um ativo novo ser venda.
- **Desfazer**: cada lote pode ser removido inteiro (operações e proventos dele); ativos criados permanecem.
- **Proventos da B3**: o valor da planilha é tratado como líquido (bruto = líquido, IR = 0).

### 11.2 Telas (App Router, Server Components + gráficos Recharts em Client Components)

| Rota | Conteúdo |
|---|---|
| `/` | KPIs, evolução da cota vs. CDI/IPCA/Ibovespa (`?janela=1M|6M|YTD|12M|ALL`), alocação por classe |
| `/ativos` | tabela por classe (`?classe=FII`): qtd, PM, cotação, saldo, resultado, rentabilidade, YoC 12M, peso |
| `/lancamentos` | sync, importação com prévia, formulário manual, histórico paginado (`?aba=&q=&pagina=`), lotes |

Definições dos KPIs: **Patrimônio** = posições + proventos recebidos; **Valor aplicado** = aportes líquidos de resgates (Σ fluxos); **Lucro** = Patrimônio − Valor aplicado (inclui realizado, não realizado e proventos); **Rentabilidade** = variação da cota na janela. Janela maior que o histórico mostra desde o início.

### 11.3 API (Route Handlers)

`POST /api/import/preview` · `POST /api/import/commit` · `DELETE /api/import/batches/:id` · `POST /api/transactions` · `DELETE /api/transactions/:id` · `POST /api/proventos` · `DELETE /api/proventos/:id` · `POST /api/sync` (`steps`: benchmarks, quotes, snapshots). Toda mutação recalcula os snapshots.

### 11.4 Limitações da Etapa 3

- Lançamentos podem ser criados e excluídos; **edição in-place ainda não existe** (exclua e relance).
- Resgate de renda fixa só total pela tela.
- Importação da planilha de **Posição** da B3 não foi implementada.
- Os layouts da B3 são presumidos; valide com um arquivo real e ajuste `b3-columns.ts`.

## 12. Etapa 3.1 — camada de cotações resiliente

Motivo: o Yahoo passou a responder `429 Too Many Requests` em **texto puro**, o que quebrava o parser JSON.

| Peça | Arquivo | Função |
|---|---|---|
| Cliente HTTP | `lib/http.ts` | lê o corpo como texto; detecta rate limit (status 429 **ou** corpo "Too Many Requests", mesmo com HTTP 200); respeita `Retry-After`; backoff exponencial com jitter; 4xx e JSON inválido não repetem |
| Throttle | `lib/quotes/throttle.ts` | intervalo mínimo entre chamadas (`QUOTE_DELAY_MS`, padrão 450 ms) |
| Yahoo | `lib/quotes/yahoo.ts` | fetch direto em `query1.finance.yahoo.com/v8/finance/chart`, com User-Agent de navegador; sem a lib `yahoo-finance2` |
| BRAPI | `lib/quotes/brapi.ts` | fallback opcional, ativo só com `BRAPI_TOKEN` |
| Cadeia | `lib/quotes/chain.ts` | tenta Yahoo → BRAPI; após 3 rate limits seguidos o provedor é pausado até o fim da execução (circuit breaker) |
| Sync | `lib/quotes/sync.ts` | 1 ticker por vez; pula tickers já atualizados até o último pregão; falha de um ticker não derruba os outros |
| Benchmarks | `lib/services/sync-benchmarks.ts` | CDI, Selic, IPCA e Ibovespa isolados: falha do Ibovespa **não** impede salvar SGS |

Configuração (`.env`): `BRAPI_TOKEN=` (opcional) e `QUOTE_DELAY_MS=450`.

Se o IP já está bloqueado, espere alguns minutos: o sync é incremental e retoma de onde parou.

## 13. Etapa 4 — eventos corporativos genéricos

### 13.1 Tipos de lançamento

| Tipo | Efeito no motor |
|---|---|
| `TRANSFER_OUT` | **Troca de ticker, incorporação, conversão de recibo.** Tira `quantity` (0 = tudo) do ativo de origem ao PM vigente e entrega ao `counterpartAssetId` com quantidade × `factor` (razão) e o **mesmo custo total**. Sem fluxo, sem resultado realizado. |
| `FRACTION_WRITEOFF` | **Baixa de fração residual.** Reduz a quantidade ao PM (que não muda). O valor recebido (`quantidade × unitPrice`, pode ser 0) é saída de caixa, como numa venda. |
| `SPLIT` / `REVERSE_SPLIT` | Fator explícito (`factor`) ou derivado da quantidade creditada/debitada. |

O ativo de origem de uma troca total passa a `isActive = false` e **não é mais consultado** nos syncs de cotação. O destino é criado se não existir. Cadeias (A→B→C) são resolvidas por ordem topológica; ciclos geram aviso.

### 13.2 Desdobramentos sem reescrever o histórico

O livro guarda quantidades e preços reais. O motor guarda, por ativo, o fator de cada desdobramento/grupamento e, ao valorizar o dia `t`, calcula `preço_negociado(t) = cotação_ajustada(t) × Π fatores dos eventos posteriores a t`. Isso funciona também quando a posição chegou por troca de ticker (a quantidade transferida sofre os desdobramentos seguintes do destino).

### 13.3 Parser da Movimentação (`src/config/b3-columns.ts`)

| Texto na B3 (contém) | Interpretação |
|---|---|
| incorporação / fusão / conversão / substituição / troca de ticker | débito em X + crédito em Y no mesmo dia e tipo ⇒ `TRANSFER_OUT` (razão = crédito ÷ débito). Ambíguo ou sem contrapartida ⇒ aviso, lançar manualmente |
| recibo de subscrição | crédito isolado ⇒ compra do recibo ao preço da linha; débito + crédito ⇒ conversão |
| desdobramento | só crédito ⇒ `SPLIT` (id idêntico ao anterior); débito + crédito ⇒ fator = créditos ÷ débitos |
| grupamento | débito + crédito ⇒ `REVERSE_SPLIT` com fator; só uma ponta ⇒ **não aplicado** |
| atualização | só se débito e crédito diferirem; senão não aplicado |
| leilão de fração | débito ⇒ `FRACTION_WRITEOFF` com o valor recebido |
| fração em ativos | crédito ⇒ `BONUS` de custo zero |

Tudo que o parser interpreta como evento aparece como **alerta** na prévia da importação; o que ele não entende aparece em "Linhas ignoradas" com o texto original da B3. Os nomes dos eventos foram escritos de memória: ajuste `MOVIMENTACAO_RULES` conforme sua planilha.

### 13.4 Conferência (`/conferencia`)

- **Comparar com a custódia**: cole `TICKER QUANTIDADE` da corretora; o sistema aponta fração, recibo, troca de ticker (diferença igual à posição de um ativo órfão), saldo ausente ou divergência sem causa óbvia. Recibo só é associado a ativo de mesmo prefixo.
- **Frações residuais**, **recibos 12/13/14 com saldo** e **posições sem cotação recente** com ação em um clique.

### 13.5 Limitações

- Valorização anterior à troca: tickers deslistados não têm cotação no Yahoo, então a posição do ticker antigo é valorizada **a custo** até a data do evento e passa a mercado no dia da troca. Isso concentra o resultado não realizado num único dia da cota (TWR). Cotações manuais/CSV para tickers antigos ficam como evolução.
- Divergências sem evento identificável (ex.: histórico anterior à janela exportada) não são corrigidas automaticamente: a Conferência só indica; um ajuste manual de saldo é um aporte e afeta o TWR.
- Bonificação, subscrição e incorporação com troca de razão exigem conferir a razão informada.

## 14. Etapa 5 — redução de custo, edição e diagnóstico

### 14.1 `COST_REDUCTION` (resgate/amortização em incorporação)

Caso: incorporação em que o acionista recebe ações resgatáveis que logo são pagas em dinheiro (Petz/Cobasi: `C9BS4`, R$ 568,84). O valor recebido **entra no caixa** e **abate o custo total** do ativo que recebeu a incorporação; a quantidade não muda e o preço médio cai.

- Motor: `custo' = custo − (quantidade × unitPrice − custos)`. Se exceder o custo, o custo zera e o excedente é resultado realizado. Sem posição no ativo, só avisa e o dinheiro entra no caixa.
- TWR: o valor é **caixa retido na carteira** (como proventos), nunca aporte/resgate.
- Parser (`Resgate`, crédito): o ativo de destino é um dos outros tickers creditados no grupo de "Incorporação" que creditou o ticker resgatado. O importador escolhe o candidato que já existe (no banco ou no lote). Sem candidato conhecido ou sem incorporação na planilha, **não aplica** e avisa; use a aba "Redução de custo".

### 14.2 Edição de lançamentos

O ícone de lápis no histórico edita data, quantidade, preço, custos e fator/razão e recalcula os snapshots (operações; proventos continuam excluir-e-relançar). Linhas importadas editadas não são duplicadas numa reimportação (o `externalId` é mantido).

### 14.3 Tickers com dígito

`TICKER_RE = /^[A-Z][A-Z0-9]{2}[A-Z]\d{1,2}$/`: aceita `B3SA3`, `C9BS4`, `A1MD34` e continua rejeitando códigos de renda fixa (`CDB123`).

### 14.4 Diagnóstico de divergências

- `/extrato/TICKER`: dias em que a quantidade ou o PM mudaram, com os lançamentos (inclui entrada/saída por troca).
- `npm run explain:b3 -- arquivo.xlsx TICKER...`: para cada linha da planilha desses tickers mostra como o importador a trata e resume créditos/débitos por tipo. Tipos sem regra aparecem como `SEM REGRA`.

## 15. Etapa 6 — Desdobro, grupamento por crédito, frações e restituição de capital

| Texto na B3 | Interpretação |
|---|---|
| **Desdobro** (crédito) | `SPLIT` por quantidade: soma à posição **mantendo o custo total** (PM cai). Se a razão derivada for um desdobramento plausível (p.ex. ×2, ×10), as cotações do provedor são "des-ajustadas"; crédito avulso (p.ex. 414→450, razão 25/23) **não** mexe nas cotações. |
| **Grupamento** (só crédito) | `REGROUP`: o crédito é a **posição final** (256 → 2,56; fator = 2,56 ÷ posição anterior). Com débito + crédito: `REVERSE_SPLIT` com fator explícito. Crédito ≥ posição: ignorado com aviso. |
| **Fração em Ativos** (débito) + **Leilão de Fração** (crédito em dinheiro) | pareados por ativo e quantidade num único `FRACTION_WRITEOFF` na data do débito, com o valor do leilão. Sem o leilão: baixa a R$ 0 (aviso). Leilão sem débito: baixa na data do leilão (aviso). |
| **Fração em Ativos** (crédito) | `BONUS` de custo zero. |
| **Restituição de Capital** (crédito) | `COST_REDUCTION` no próprio ativo; a "Quantidade" da B3 é informativa e **não** entra na posição. |

Ordem no mesmo dia (por ativo): grupamento → baixa de fração → desdobramento/bonificação → compras → vendas/redução de custo → troca de ticker. Isso reproduz o caso CASH3 de 02/06/2023 (256 → 2,56 → 2 → 20) independentemente da ordem em que a B3 lista as linhas.

### Diagnóstico

`npm run explain:b3 -- Movimentacao.xlsx Negociacao.xlsx TICKER...` mostra o resumo por tipo, o tratamento de cada linha, os **eventos que seriam lançados** e a **posição simulada** (quantidade, PM e custo, passo a passo) para conferir com a custódia antes de importar.
