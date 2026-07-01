# ESCOPO DE TRABALHO — Camada de aprendizado coletivo no claude-mem

> **Como usar este documento:** ele é autossuficiente. Foi escrito para ser
> entregue a um chat/execução que **não participou da análise anterior**. Ele
> contém todo o contexto, os passos, os arquivos e os critérios de aceite
> necessários para executar o trabalho.
> **Ordem de leitura obrigatória:** REGRA DURA (abaixo) → BLOCO 1 (Fase 0, gate)
> → só então BLOCO 2. **Nada do BLOCO 2 começa antes do BLOCO 1 fechar.**
>
> **Branch de trabalho:** `claude/ruflus-agent-learning-6xu1tm`
> **Repositório:** `paulovaleverde/claude-mem` · **PR:** #1 (draft)
> **Documentos de apoio (contexto, NÃO fonte de verdade):**
> - `docs/research/ruflo-collective-learning.md` — o que é o Ruflo e a comparação técnica
> - `docs/research/ruflo-implantacao-claude-mem.md` — diagnóstico e as 7 camadas de segurança
>
> ⚠️ Os documentos de apoio foram redigidos a partir de **log de sessão não
> auditado**. Servem de contexto, mas **não confirmam nada**. A confirmação é
> tarefa do BLOCO 1.

---

## ⚠️ REGRA DURA — âncoras NÃO confirmadas (ler antes de tudo)

Este escopo nasceu de um log de sessão **não auditado**. Por isso, **nenhuma das
três âncoras abaixo pode ser tratada como fundação existente** até a **Fase 0
(BLOCO 1)** confirmá-la contra o **código real**. Todas entram como
**ALVOS A RECONFERIR**, não como fatos:

| # | Âncora (alegada pelo log) | Status |
|---|---------------------------|--------|
| **A** | `reuseScore` reordenando o caminho `orderBy="relevance"` | 🔲 **[A RECONFERIR]** |
| **B** | Tabela `observation_feedback` + coluna `relevance_count` existem e funcionam | 🔲 **[A RECONFERIR]** |
| **C** | `evaluateForReasoningBank` acionável no hook `Stop` (`/api/sessions/summarize`) | 🔲 **[A RECONFERIR]** |

Regras derivadas:
1. Qualquer frase deste documento que diga "já existe", "já foi construído",
   "fundação pronta" sobre A/B/C é **alegação**, não fato, até o BLOCO 1 marcá-la
   `[Certo]` com arquivo+linhas.
2. Se o BLOCO 1 rebaixar uma âncora para `[Palpite]` ou "não localizado", o item
   do BLOCO 2 que depende dela **não é executado** — segue a TABELA DE DECISÃO.
3. **Nenhum wire** (ligação ao runtime) acontece antes do pré-requisito da **P4**
   (a trava do funil de escrita) estar no lugar.

---

## Contexto mínimo (para quem chega agora)

**claude-mem** é um plugin do Claude Code que dá memória persistente entre
sessões. Ele captura o trabalho via hooks de ciclo de vida, comprime em
"observações" (worker Express na porta 37777), guarda em SQLite
(`~/.claude-mem/claude-mem.db`) + vetores (Chroma), e injeta contexto em sessões
futuras.

**O projeto tem um "time de agentes" e compartilha conhecimento** (skills `do`,
`make-plan`, `mem-search`, `smart-explore`, `knowledge-agent`). *Grau de
maturidade real desse compartilhamento = a confirmar no BLOCO 1.*

**Objetivo geral do trabalho:** fechar o *loop de aprendizado por feedback* —
memória que aprende qual conteúdo foi útil. **Mas** as peças que se supõe existir
para isso (âncoras A/B/C acima, e a POC em `src/services/learning/reasoning-bank.ts`
+ `tests/learning/reasoning-bank.test.ts`) **são alegações do log** e precisam ser
reconferidas antes de qualquer esforço de ligação.

## Objetivo

Fechar o loop de aprendizado coletivo **somente se** a auditoria de ancoragem
(BLOCO 1) liberar: memórias úteis sobem no ranking; estratégias vencedoras são
promovidas; e mede-se o ganho. Regra de ouro permanente: **o aprendizado muda
ranking/recuperação, nunca executa ações**. O humano segue no comando do
irreversível.

## Princípios inegociáveis (guardrails — valem para TODOS os blocos)

1. **Sugerir, não agir.** O código de aprendizado só afeta ordenação e
   recuperação de memórias. Nunca dispara commit, push, deleção ou qualquer ação
   externa automaticamente.
2. **Gate humano no irreversível.** Não altere os gates existentes do skill `do`
   (verificação antes de commit).
3. **Privacidade na borda.** Não mexa no strip de `<private>` (`src/utils/tag-stripping.ts`).
   Nada privado pode entrar na memória/aprendizado.
4. **Fail-safe.** A camada de aprendizado é fire-and-forget: se falhar, o worker e
   os hooks **não podem travar** o trabalho real. try/catch + log, não propague.
5. **Isolamento por projeto.** Respeite o filtro `project`/coleções `cm__{project}`.
   **Federação entre máquinas está FORA DE ESCOPO.**
6. **Sem novas dependências pesadas.** Reuse SQLite/Chroma/worker já existentes.
7. **Reversível.** Toda migration nova precisa de `down`. Nada destrutivo.
8. **Trava do funil de escrita (P4).** Antes de qualquer wire, uma observação só
   é gravada se passar por uma trava que **recusa fato do cliente**
   (lei/número/citação) e **aceita só estratégia de execução**. Ver BLOCO 1 · P4.

## Fora de escopo (não fazer)

- Federação / compartilhamento entre máquinas ou repositórios.
- Qualquer forma de execução autônoma de ações.
- Fine-tuning de modelos ou treinamento neural (SONA-like). Heurística
  transparente, não caixa-preta.
- UI proprietária/Pro. Endpoints ficam abertos em localhost:37777 (ver CLAUDE.md).

## 🚫 NÃO TOCAR (intocável nesta iniciativa)

- `~/vale-verde-pipeline/`
- As 7 skills vendorizadas
- `mapa-garantias`
- `Cérebro Vale Verde`
- Os hooks existentes

---

# BLOCO 1 — FASE 0: Auditoria de ancoragem (PORTÃO)

**Este bloco é um portão.** Nenhuma linha do BLOCO 2 é executada enquanto as 4
perguntas abaixo não forem respondidas e a TABELA DE DECISÃO não apontar um
cenário. **Não escreva código de feature neste bloco** — só auditar e decidir.

**Formato obrigatório de cada resposta:** `arquivo + linhas + etiqueta`, onde a
etiqueta é uma de: **[Certo]** (confirmado no código), **[Provável]** (indício
forte, sem prova direta), **[Palpite]** (inferência sem evidência). Se algo não
for localizado, escreva explicitamente **"não localizado — foi inferência"**.

### P1 — Os tiers temporais são reais no Ruflo?
Os tiers `working/episodic/semantic` (ou `1h/7d/∞`) **existem no código do Ruflo
(`ruvnet/ruflo`)** ou foram **inferidos** da documentação/marketing?
- Se não localizar no código-fonte: responder **"não localizado — foi inferência"**.
- Saída: `arquivo+linhas+etiqueta` OU a frase de inferência.

### P2 — O caminho de LEITURA do ReasoningBank é barato?
O caminho de **leitura/rerank** do ReasoningBank upstream é **sub-segundo**, ou
também paga os **10–45s** que a **escrita** paga? *(Isto decide a viabilidade em
runtime — rerank caro no hot path da busca é inviável.)*
- Saída: latência de leitura estimada/medida + `etiqueta` + evidência.

### P3 — O que do claude-mem existe DE FATO (vs. otimismo)?
Verificar **contra o código real do claude-mem** se existem e fazem o que se
afirma, item a item:
- `reuseScore` ligado a `orderBy="relevance"` (âncora **A**);
- tabela `observation_feedback` (âncora **B**);
- coluna `relevance_count` (âncora **B**);
- busca híbrida **FTS5 + Chroma**.
- Saída: uma tabela **"existe de fato" × "foi otimismo"**, cada linha com
  `arquivo+linhas+etiqueta`.

### P4 — Onde está o funil único de escrita?
Localizar no claude-mem o **funil único de escrita**: o ponto por onde **toda**
observação passa antes de ser gravada. É **onde entra a trava** que:
- **recusa** gravar **fato do cliente** (lei / número / citação);
- **aceita** apenas **estratégia de execução**.
- Saída: `arquivo+linhas+etiqueta` do funil + esboço de onde a trava se insere.

### TABELA DE DECISÃO (resolver antes de abrir o BLOCO 2)

| P1 (tiers Ruflo) | P2 (leitura) | Decisão |
|------------------|--------------|---------|
| **inferido** | **cara** | 🛑 **PARA.** Fase 2 morre; ReasoningBank fica só como funções puras (sem wire). |
| **real** | **cara** | ⚠️ Tiers **sim**, rerank em runtime **não**. Consultar estratégia **fora do hot path** (session-start), **não** no `SearchRoutes`. |
| **inferido** | **barata** | ⚠️ **Adiar tiers.** Seguir só com o ReasoningBank de estratégia. |
| **real** | **barata** | ✅ **Verde** para Fase 1 → 2, sob **feature-flag default-off**. |

**Pré-requisito inegociável em QUALQUER cenário verde/parcial:** a **trava da P4**
entra **antes** de qualquer wire. Sem trava, nenhum item do BLOCO 2 roda.

### Definition of Done — Fase 0
- [ ] P1, P2, P3, P4 respondidas no formato `arquivo+linhas+etiqueta`.
- [ ] Âncoras A/B/C reclassificadas de `[A RECONFERIR]` para `[Certo]`/`[Provável]`/`[Palpite]`.
- [ ] Cenário da TABELA DE DECISÃO escolhido e registrado.
- [ ] Trava da P4 especificada (onde entra, o que recusa, o que aceita).
- [ ] Aprovação humana explícita para abrir o BLOCO 2.

---

# BLOCO 2 — FASE 1: fechar o loop (CONDICIONADO ao BLOCO 1)

> **Todo este bloco está CONDICIONADO à confirmação da Fase 0.** Só executar o
> item cujo cenário da TABELA DE DECISÃO permitir, e **somente após** a trava da
> P4 estar no lugar. Conteúdo mantido **intacto** em relação à versão anterior;
> o que mudou foi a condição de entrada.

Três itens de trabalho + medição. Ordem recomendada: 2.1 → 2.2 → 2.3.

### 2.1 — Ligar `reuseScore` ao ranking de busca
**[CONDICIONADO à Fase 0 — depende da âncora A `[A RECONFERIR]` e de P2 leitura barata]**

**Objetivo:** quando a busca é ordenada por relevância, reordenar usando o
`reuseScore` (reuso + feedback + recência) da POC.

**Arquivos:**
- Módulo (a reconferir na P3): `src/services/learning/reasoning-bank.ts` (usar `rankByReuse` / `reuseScore`).
- Ponto de integração: rotas de busca do worker em
  `src/services/worker/http/routes/SearchRoutes.ts` (endpoints `/api/search*`,
  ~linhas 50-257) e o caminho `orderBy="relevance"` do `mem-search`.

**Passos:**
1. Localizar onde o resultado de busca é ordenado quando `orderBy="relevance"`.
2. Para cada observação candidata, montar `ScorableObservation`
   (`id`, `type`, `createdAtEpoch`, `relevanceCount`) e buscar seus
   `FeedbackSignals` agregados de `observation_feedback` (por `signal_type`).
3. Aplicar `rankByReuse(...)` (ou multiplicar `reuseScore` no score de relevância
   existente — decidir e documentar a fórmula escolhida).
4. Manter o comportamento atual como fallback quando não há feedback (cold-start).

**Aceite:**
- Busca com `orderBy="relevance"` retorna observações mais reusadas/positivas
  acima das inéditas, com feedback igual.
- Sem feedback, o ranking não piora em relação ao atual (teste de regressão).
- Nova função coberta por teste unitário.

### 2.2 — Instrumentar a coleta de sinais de feedback (o elo que falta)
**[CONDICIONADO à Fase 0 — depende da âncora B `[A RECONFERIR]`]**

**Objetivo:** popular `observation_feedback` de verdade, nos pontos onde já se
sabe se uma memória ajudou. Sem isso, o `reuseScore` não aprende.

**Arquivos (existência a confirmar na P3):**
- Tabela: `observation_feedback` (migration008 em `src/services/sqlite/migrations.ts:521`).
- Coluna a incrementar: `observations.relevance_count` (migration009).
- Pontos de gravação: rotas de busca/contexto em `SearchRoutes.ts`; injeção de
  contexto em `SessionStart` (`/api/context/inject`); `knowledge-agent`.

**Sinais a gravar (`signal_type`):**
- `search` — observação apareceu em um resultado de busca.
- `hit` — observação recuperada foi de fato usada/referenciada.
- `miss` — observação apareceu mas foi descartada.
- `retrieval` — observação recuperada explicitamente (timeline/by-id/corpus).

**Passos:**
1. Criar um helper `recordFeedback(observationId, signalType, sessionDbId?, metadata?)`
   que insere em `observation_feedback` e incrementa `relevance_count` em `hit`.
2. Chamar o helper nos pontos de recuperação (começar por `search` e `retrieval`,
   que são inequívocos; `hit`/`miss` podem exigir heurística — documentar).
3. Garantir fire-and-forget: gravação nunca bloqueia a resposta ao hook.

**Aceite:**
- Após uma sessão real de uso, `observation_feedback` tem linhas e
  `relevance_count` cresce para observações reutilizadas.
- Falha ao gravar feedback não quebra a busca nem o worker (teste de fail-safe).

### 2.3 — Promover estratégias no fim da sessão (ReasoningBank)
**[CONDICIONADO à Fase 0 — depende da âncora C `[A RECONFERIR]` e da trava da P4]**

**Objetivo:** ao encerrar a sessão, avaliar observações-estratégia e marcar as
promovidas para reuso prioritário.

**Arquivos (a reconferir na P3):**
- Função: `evaluateForReasoningBank(...)` em `reasoning-bank.ts`.
- Ponto de integração: handler do hook `Stop` → `POST /api/sessions/summarize`
  (`handleSummarizeByClaudeId`, `SessionRoutes.ts`).

**Passos:**
1. Após gerar o summary, iterar nas observações da sessão do tipo estratégia
   (`decision`/`bugfix`/`discovery`), buscar feedback, chamar `evaluateForReasoningBank`.
2. Persistir a decisão de promoção (ver BLOCO 3 · Fase 2 para a coluna `tier`; por
   ora, registrar via `metadata`/flag ou log estruturado, sem schema novo se possível).

**Aceite:**
- Estratégias com feedback positivo e reuso comprovado são marcadas como promovidas.
- Feedback líquido negativo **nunca** promove (garantido por `evaluateForReasoningBank`).
- A trava da P4 recusou qualquer fato do cliente antes da gravação.

### 2.4 — Medição (pré-requisito para decidir o BLOCO 3)
**[CONDICIONADO à Fase 0]**

**Objetivo:** provar o ganho antes de investir mais.

**Passos:**
1. Expor duas métricas (endpoint simples e/ou painel no viewer `localhost:37777`):
   - **hit-rate**: `hit / (hit + miss)` das memórias recuperadas.
   - **tokens economizados**: soma de `discovery_tokens` de observações reusadas.
2. Registrar baseline antes de ativar a Fase 1.

**Aceite:** as duas métricas são visíveis e comparáveis antes/depois.

---

# BLOCO 3 — ROADMAP (Fases 2/3 — só após métricas do BLOCO 2)

Não executar agora. Depende do cenário da TABELA DE DECISÃO (Fase 2 pode estar
**morta** se P1=inferido E P2=cara) e das métricas do BLOCO 2.

- **Fase 2 — Tiers + decay:** coluna `tier` (`working`/`episodic`/`semantic`) em
  `observations` (migration com `down`); job que reavalia tier via `assignTier` e
  poda expirados via `isExpired`; injeção de contexto prioriza `semantic`.
  **Só existe se P1=real.**
- **Fase 3 — Grafo causal:** tabela `observation_edges(from_id, to_id, kind,
  confidence, decay)`; pathfinding "decisão → efeito" sobre o timeline existente.

**Gatilho para avançar:** hit-rate medido melhora de forma consistente por ~2
semanas de uso real **E** cenário verde na TABELA DE DECISÃO.

---

## Convenções do projeto (obrigatórias)

- **Build:** `npm run build` (hooks TS → ESM em `plugin/scripts/*-hook.js`).
- **Testes:** `bun test` (todos) ou `bun test tests/learning/` (desta feature).
  Todo novo comportamento precisa de teste.
- **Estilo:** TypeScript ESM, imports com extensão `.js`. Mockar `logger` nos
  testes (ver `tests/shared/timeline-formatting.test.ts` como referência).
- **Changelog:** **não editar** — é gerado automaticamente (ver CLAUDE.md).
- **Git:** desenvolver na branch `claude/ruflus-agent-learning-6xu1tm`; commits
  descritivos; push para a mesma branch; PR #1 já existe (draft).
- **Migrations:** sempre com `up` e `down`; nunca destrutivas.

## Definition of Done (Fase 1 / BLOCO 2 — só após BLOCO 1 verde)

- [ ] **Fase 0 (BLOCO 1) fechada e aprovada** — pré-condição de tudo abaixo.
- [ ] **Trava da P4 no lugar** antes de qualquer wire.
- [ ] `reuseScore` ligado ao ranking `orderBy="relevance"`, com fallback de cold-start.
- [ ] `observation_feedback` sendo populada em uso real; `relevance_count` cresce.
- [ ] Promoção de estratégia rodando no hook `Stop`, sem promover feedback negativo.
- [ ] hit-rate e tokens economizados visíveis, com baseline registrado.
- [ ] Todos os testes passando (`bun test`); nenhum guardrail violado.
- [ ] Nenhuma ação autônoma introduzida; gates humanos intactos.
- [ ] Documentação atualizada e PR #1 pronto para revisão.

---

### Resumo em uma linha
**Primeiro auditar as âncoras (BLOCO 1 · Fase 0), com a trava do funil de escrita
como pré-requisito;** só sob cenário verde ligar a POC ao runtime em três pontos
(ranking, feedback, promoção) + medição — sem jamais dar autonomia de ação.
