# ESCOPO DE TRABALHO — Camada de aprendizado coletivo no claude-mem

> **Como usar este documento:** ele é autossuficiente. Foi escrito para ser
> entregue a um chat/execução que **não participou da análise anterior**. Ele
> contém todo o contexto, os passos, os arquivos e os critérios de aceite
> necessários para executar o trabalho. Leia a seção 0 antes de começar.
>
> **Branch de trabalho:** `claude/ruflus-agent-learning-6xu1tm`
> **Repositório:** `paulovaleverde/claude-mem` · **PR:** #1 (draft)
> **Documentos de apoio (leitura obrigatória antes de codar):**
> - `docs/research/ruflo-collective-learning.md` — o que é o Ruflo e a comparação técnica
> - `docs/research/ruflo-implantacao-claude-mem.md` — diagnóstico e as 7 camadas de segurança

---

## 0. Contexto mínimo (para quem chega agora)

**claude-mem** é um plugin do Claude Code que dá memória persistente entre
sessões. Ele captura o trabalho via 5 hooks de ciclo de vida, comprime em
"observações" usando o Claude Agent SDK (num worker Express na porta 37777),
guarda em SQLite (`~/.claude-mem/claude-mem.db`) + vetores (Chroma), e injeta
contexto relevante em sessões futuras.

**O projeto já tem um "time de agentes" e já compartilha conhecimento:**
- Skills que orquestram subagentes: `do`, `make-plan`.
- Skills que recuperam memória: `mem-search`, `smart-explore`, `knowledge-agent`.
- Toda observação de um subagente vira conhecimento pesquisável por qualquer
  agente futuro.

**O que falta (o objetivo deste trabalho):** o *loop de aprendizado por
feedback*. Hoje a memória é passiva — não aprende qual conteúdo foi útil. Já
existem as fundações não usadas: a tabela `observation_feedback` (migration008,
descrita no código como *"foundation for future Thompson Sampling
optimization"*) e a coluna `observations.relevance_count` (migration009).

**Já foi construído nesta branch (POC pronta e testada):**
- `src/services/learning/reasoning-bank.ts` — funções puras de scoring/tiers.
- `tests/learning/reasoning-bank.test.ts` — 21 testes passando (`bun test tests/learning/`).
Essa POC **ainda não está ligada** ao runtime. Este escopo é sobre **ligá-la**.

---

## 1. Objetivo

Fechar o loop de aprendizado coletivo: memórias comprovadamente úteis sobem no
ranking; estratégias vencedoras são promovidas para reuso; e é possível **medir**
o ganho. Tudo mantendo a regra de ouro: **o aprendizado muda ranking/recuperação,
nunca executa ações**. O humano segue no comando de tudo que é irreversível.

## 2. Princípios inegociáveis (guardrails)

Estas regras valem para **todo** passo abaixo. Não podem ser violadas.

1. **Sugerir, não agir.** O código de aprendizado só afeta ordenação e
   recuperação de memórias. Nunca dispara commit, push, deleção ou qualquer ação
   externa automaticamente.
2. **Gate humano no irreversível.** Não altere os gates existentes do skill `do`
   (verificação antes de commit).
3. **Privacidade na borda.** Não mexa no strip de `<private>` (`src/utils/tag-stripping.ts`).
   Nada privado pode entrar na memória/aprendizado.
4. **Fail-safe.** A camada de aprendizado é fire-and-forget: se falhar, o worker e
   os hooks **não podem travar** o trabalho real. Envolva em try/catch e logue,
   não propague.
5. **Isolamento por projeto.** Respeite o filtro `project`/coleções `cm__{project}`.
   **Federação entre máquinas está FORA DE ESCOPO.**
6. **Sem novas dependências pesadas.** Reuse SQLite/Chroma/worker já existentes.
7. **Reversível.** Toda migration nova precisa de `down`. Nada deve ser destrutivo.

## 3. Fora de escopo (não fazer)

- Federação / compartilhamento entre máquinas ou repositórios.
- Qualquer forma de execução autônoma de ações.
- Fine-tuning de modelos ou treinamento neural (SONA-like). Usamos heurística
  transparente, não caixa-preta.
- UI proprietária/Pro. Endpoints ficam abertos em localhost:37777 (ver CLAUDE.md).

---

## 4. ESCOPO PRIMÁRIO — Fase 1: fechar o loop (fazer agora)

Três itens de trabalho. Ordem recomendada: 4.1 → 4.2 → 4.3.

### 4.1 — Ligar `reuseScore` ao ranking de busca

**Objetivo:** quando a busca é ordenada por relevância, reordenar usando o
`reuseScore` (reuso + feedback + recência) da POC.

**Arquivos:**
- Módulo pronto: `src/services/learning/reasoning-bank.ts` (usar `rankByReuse` / `reuseScore`).
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

### 4.2 — Instrumentar a coleta de sinais de feedback (o elo que falta)

**Objetivo:** popular `observation_feedback` de verdade, nos pontos onde já se
sabe se uma memória ajudou. Sem isso, o `reuseScore` não aprende.

**Arquivos:**
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

### 4.3 — Promover estratégias no fim da sessão (ReasoningBank)

**Objetivo:** ao encerrar a sessão, avaliar observações-estratégia e marcar as
promovidas para reuso prioritário.

**Arquivos:**
- Função pronta: `evaluateForReasoningBank(...)` em `reasoning-bank.ts`.
- Ponto de integração: handler do hook `Stop` → `POST /api/sessions/summarize`
  (`handleSummarizeByClaudeId`, `SessionRoutes.ts`).

**Passos:**
1. Após gerar o summary, iterar nas observações da sessão do tipo estratégia
   (`decision`/`bugfix`/`discovery`), buscar feedback, chamar `evaluateForReasoningBank`.
2. Persistir a decisão de promoção (ver Fase 2 para a coluna `tier`; por ora,
   registrar via `metadata`/flag ou log estruturado, sem schema novo se possível).

**Aceite:**
- Estratégias com feedback positivo e reuso comprovado são marcadas como promovidas.
- Feedback líquido negativo **nunca** promove (já garantido por `evaluateForReasoningBank`).

### 4.4 — Medição (pré-requisito para decidir Fases 2/3)

**Objetivo:** provar o ganho antes de investir mais.

**Passos:**
1. Expor duas métricas (endpoint simples e/ou painel no viewer `localhost:37777`):
   - **hit-rate**: `hit / (hit + miss)` das memórias recuperadas.
   - **tokens economizados**: soma de `discovery_tokens` de observações reusadas
     (reuso evita redescoberta).
2. Registrar baseline antes de ativar a Fase 1.

**Aceite:** as duas métricas são visíveis e comparáveis antes/depois.

---

## 5. ROADMAP (próximos ciclos — só após métricas da Fase 1)

Não executar agora. Fica documentado para o planejamento seguinte.

- **Fase 2 — Tiers + decay:** coluna `tier` (`working`/`episodic`/`semantic`) em
  `observations` (migration com `down`); job que reavalia tier via `assignTier` e
  poda expirados via `isExpired`; injeção de contexto prioriza `semantic`.
- **Fase 3 — Grafo causal:** tabela `observation_edges(from_id, to_id, kind,
  confidence, decay)`; pathfinding "decisão → efeito" sobre o timeline existente.

**Gatilho para avançar:** hit-rate medido melhora de forma consistente por ~2
semanas de uso real.

---

## 6. Convenções do projeto (obrigatórias)

- **Build:** `npm run build` (hooks TS → ESM em `plugin/scripts/*-hook.js`).
- **Testes:** `bun test` (todos) ou `bun test tests/learning/` (desta feature).
  Todo novo comportamento precisa de teste.
- **Estilo:** TypeScript ESM, imports com extensão `.js`. Mockar `logger` nos
  testes (ver `tests/shared/timeline-formatting.test.ts` como referência).
- **Changelog:** **não editar** — é gerado automaticamente (ver CLAUDE.md).
- **Git:** desenvolver na branch `claude/ruflus-agent-learning-6xu1tm`; commits
  descritivos; push para a mesma branch; PR #1 já existe (draft).
- **Migrations:** sempre com `up` e `down`; nunca destrutivas.

## 7. Definition of Done (Fase 1)

- [ ] `reuseScore` ligado ao ranking `orderBy="relevance"`, com fallback de cold-start.
- [ ] `observation_feedback` sendo populada em uso real; `relevance_count` cresce.
- [ ] Promoção de estratégia rodando no hook `Stop`, sem promover feedback negativo.
- [ ] hit-rate e tokens economizados visíveis, com baseline registrado.
- [ ] Todos os testes passando (`bun test`); nenhum guardrail da seção 2 violado.
- [ ] Nenhuma ação autônoma introduzida; gates humanos intactos.
- [ ] Documentação atualizada e PR #1 pronto para revisão.

---

### Resumo em uma linha
Ligar a POC de aprendizado (`reasoning-bank.ts`) ao runtime em três pontos —
**ranking de busca, coleta de feedback e promoção no fim da sessão** — mais
**medição**, sem jamais dar autonomia de ação ao sistema.
