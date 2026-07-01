# Ruflo (ex-"Claude Flow"): aprendizado coletivo entre agentes

> Relatório de pesquisa — análise do projeto **Ruflo** e do que ele tem a ensinar para o **claude-mem**.
> Origem: vídeo no Instagram onde o apresentador fala de um grupo de agentes ("Ruflus") que
> compartilham conhecimento e evoluem juntos. "Ruflus" = **Ruflo** (pronúncia ru-flo).

## 1. O que é o Ruflo

**Ruflo** é um *meta-harness* (camada de orquestração) de agentes de IA que roda **por cima do
Claude Code e do Codex**. Ele transforma um único agente em **enxames (swarms) de agentes
especializados** que coordenam tarefas, compartilham memória e aprendem com cada execução.

| Item | Detalhe |
|------|---------|
| Repositório | [github.com/ruvnet/ruflo](https://github.com/ruvnet/ruflo) (~60k★) |
| Autor | ruvnet (rUv) |
| Origem | Nasceu como **Claude Flow** (jun/2025), reescrito em **Rust**, renomeado para Ruflo |
| Pacote npm / CLI | ainda `claude-flow` |
| Posição | "The leading agent meta-harness for Claude" |

O renome de `claude-flow` → `ruflo` foi por questões de marca; o pacote npm e o comando de CLI
continuam `claude-flow`.

## 2. O que impressiona: agentes que aprendem e evoluem juntos

O recurso é documentado e tem nome: **Hive-Mind Intelligence** (Inteligência de Colmeia).
Não é AGI nem mágica — é **engenharia de memória vetorial + reforço por feedback**. Os
mecanismos concretos:

### 2.1 Arquitetura "Queen-led" (liderada por uma Rainha)
- Uma agente **Queen** coordena agentes **worker** especializados (researcher, coder, reviewer,
  tester, etc.). São 100+ tipos de agentes.
- Coordenação por **consenso** e **topologias** configuráveis, não um único agente fazendo tudo.
- Suporte de infraestrutura: 314 ferramentas MCP, 26 comandos de CLI, 17 hooks + 12 workers
  de background.

### 2.2 Memória compartilhada em 3 camadas (o coração do "aprender juntos")

| Camada | Tecnologia | Papel |
|--------|-----------|-------|
| Base | SQLite (`.swarm/memory.db`, SQL.js) | Texto + metadados (TTL, tags, source) |
| Busca | Índice vetorial **HNSW** + quantização **RaBitQ 1-bit** (32× compressão) | Busca semântica 150×–12.500× mais rápida que força bruta |
| Topo | **Grafo de conhecimento temporal** (ADR-130) | Relações causais entre conceitos, com confidence score e decaimento temporal |

O grafo causal tem arestas com metadados (confiança, taxa de decaimento, "testemunhas") e
**6 algoritmos de pathfinding**: shortest-path, highest-confidence, highest-impact,
most-recent, least-decayed, multi-hop-influence — permitindo rastrear cadeias de decisão e
propagação de influência.

### 2.3 Tiers temporais de memória (separa o descartável do aprendido)

| Tier | TTL | Papel |
|------|-----|-------|
| **working** | 1 hora | dados transitórios da sessão |
| **episodic** | 7 dias | episódios recentes |
| **semantic** | indefinido | comportamento aprendido e duradouro |

Namespaces organizam as memórias por finalidade: `patterns`, `tasks`, `feedback`,
`collaboration`.

### 2.4 Como o conhecimento "cresce junto" — os 3 mecanismos-chave

1. **ReasoningBank**: trajetórias de raciocínio são gravadas; estratégias **bem-sucedidas**
   ficam persistidas para agentes atuais **e futuros** reutilizarem via busca HNSW.
   Cada workflow bem-sucedido vira "dado de treino" — em vez de redescobrir soluções,
   os agentes recuperam padrões que já funcionaram.
2. **SONA (Swarm Optimization via Neural Adaptation)**: pattern-matching neural (Rust→WASM)
   que aprende com as trajetórias dos runs bem-sucedidos e aplica esse aprendizado a tarefas
   futuras **sem fine-tuning manual** (adaptação <0,05ms).
3. **Loop de feedback**: scores de feedback treinam o sistema a **preferir** abordagens que
   funcionaram. Auto-melhoria sem intervenção manual.

### 2.5 Federação — a "mente coletiva" distribuída
- Agentes em **máquinas diferentes** conversam com segurança **sem vazar dados**.
- Um padrão de refatoração descoberto no repo de um time beneficia todos — **sem expor o
  código original**. O contexto proprietário de cada ambiente permanece isolado; só o
  *aprendizado* é compartilhado.

## 3. SPARC — a metodologia por trás dos agentes

SPARC = **S**pecification → **P**seudocode → **A**rchitecture → **R**efinement → **C**ompletion.
É um framework de TDD que guia o desenvolvimento assistido por IA em 5 fases sequenciais, cada
uma com modos de agente especializados e integração com a memória. Cada fase alimenta a próxima
num pipeline coordenado. Usado para features novas, mudanças arquiteturais, integração e
requisitos ainda pouco claros.

## 4. Comparação técnica: Ruflo × claude-mem

O claude-mem **já tem ~80% da infraestrutura de memória** que o Ruflo usa. A
diferença não está na fundação — está na *camada de aprendizado* construída sobre ela.

| Capacidade | Ruflo | claude-mem (hoje) | Arquivo de referência |
|------------|-------|-------------------|-----------------------|
| Persistência | SQLite `.swarm/memory.db` | SQLite `~/.claude-mem/claude-mem.db` | `src/services/sqlite/SessionStore.ts:78` |
| Busca vetorial | HNSW + RaBitQ | Chroma (chroma-mcp, por campo) | `src/services/sync/ChromaSync.ts:335` |
| Busca full-text | — | FTS5 (`observations_fts`) | `migrations.ts` (migration024) |
| Captura de contexto | 17 hooks + 12 workers | 5 hooks de ciclo de vida | `plugin/hooks/hooks.json` |
| Compressão | memória adaptativa | Worker + Claude Agent SDK | `src/services/worker-service.ts` |
| Tipos de memória | patterns/tasks/feedback/collab | decision/bugfix/feature/refactor/discovery/change | `src/types/database.ts:64` |
| Contador de reuso | feedback score | **`relevance_count`** (já existe!) | `migrations.ts` (migration009) |
| Sinais de feedback | scores de reforço | **`observation_feedback`** (já existe!) | `migrations.ts:521` |
| ROI / custo | — | `discovery_tokens` por observação | `migrations.ts` (migration007) |
| **Tiers temporais (TTL/decay)** | ✅ working/episodic/semantic | ❌ tudo é indefinido | — |
| **Grafo causal** | ✅ ADR-130, 6 pathfinders | ❌ só timeline por epoch | `SearchRoutes.ts` (`/api/context/timeline`) |
| **ReasoningBank (promoção de estratégia)** | ✅ SONA + trajetórias | ❌ não há promoção | — |
| **Ranking por feedback** | ✅ loop de reforço | 🟡 tabela existe, ranking não usa | `SearchRoutes.ts:50` |
| **Aprendizado entre sessões/agentes** | ✅ federação | ❌ foco em sessão única | — |

### Descoberta-chave

A migration que cria `observation_feedback` se descreve literalmente como
*"foundation for future Thompson Sampling optimization"*, e `relevance_count` é
*"incremented by the feedback recording pipeline"*. Ou seja: **o próprio
claude-mem já planeja usar feedback para otimizar ranking** — só não construiu a
camada ainda. O que o Ruflo faz é exatamente essa camada.

## 5. Proposta: trazer aprendizado coletivo para o claude-mem

Três incrementos, do mais barato ao mais ambicioso. Cada um reutiliza o que já existe.

### Fase 1 — ReasoningBank por feedback (POC já incluída) ✅
**Objetivo**: memórias *comprovadamente úteis* sobem no ranking; estratégias
vencedoras são promovidas a um tier "semantic" permanente — sem fine-tuning.

- **Reusa**: `relevance_count`, `observation_feedback` (hit/miss/search/retrieval),
  `type`, `created_at_epoch`.
- **Adiciona**: módulo puro `src/services/learning/reasoning-bank.ts` com:
  - `reuseScore()` — score (0,1) combinando reuso + feedback + decaimento de recência;
  - `assignTier()` — working / episodic / semantic (TTLs do Ruflo: 1h / 7d / ∞);
  - `evaluateForReasoningBank()` — decide se uma observação vira estratégia reutilizável;
  - `rankByReuse()` — reordena resultados híbridos (FTS5 + Chroma).
- **Integração futura**: multiplicar `reuseScore` no ranking de
  `SearchRoutes.ts:50` e chamar `evaluateForReasoningBank()` no hook `Stop`
  (`/api/sessions/summarize`).
- **Status**: implementado como POC pura + 21 testes (`bun test tests/learning/`).
  Não wired no worker ainda (sem risco para runtime).

### Fase 2 — Tiers temporais com decaimento
**Objetivo**: separar o transitório do aprendido, como o Ruflo.

- **Adiciona**: coluna `tier` em `observations` (migration nova) + job que reavalia
  tier via `assignTier()` e poda working/episodic expirados (`isExpired()`).
- **Ganho**: contexto injetado no `SessionStart` (`/api/context/inject`) prioriza
  o tier `semantic` — o "núcleo aprendido" do projeto.

### Fase 3 — Grafo causal (estilo ADR-130)
**Objetivo**: ligar decisões a seus efeitos ("essa decisão causou esse bugfix").

- **Adiciona**: tabela `observation_edges (from_id, to_id, kind, confidence, decay)`
  e algoritmos de pathfinding sobre o timeline já existente.
- **Ganho**: ao buscar um bug, o claude-mem traz a *cadeia de decisões* que levou
  até ele — não só observações isoladas.

### Fora de escopo (por ora)
Federação entre máquinas (compartilhar aprendizado entre repos sem vazar código).
É o recurso mais chamativo do Ruflo, mas exige infra de rede/segurança que foge do
núcleo open-source atual do claude-mem.

## 6. Conclusão

O "Ruflus" do vídeo é o **Ruflo**, e o que impressiona — agentes que "aprendem e
evoluem juntos" — é **memória tiered + ReasoningBank + loop de feedback**, não AGI.
O claude-mem já tem a fundação (SQLite, vetores, feedback, contador de reuso) e até
um comentário no código planejando essa otimização. A **Fase 1 está implementada
nesta branch como prova de conceito testada**, pronta para ser plugada no ranking.

### Fontes
- [github.com/ruvnet/ruflo](https://github.com/ruvnet/ruflo) — repositório
- [Hive Mind Intelligence (wiki)](https://github.com/ruvnet/ruflo/wiki/Hive-Mind-Intelligence)
- [Memory and Graph (wiki)](https://github.com/ruvnet/ruflo/wiki/Memory-and-Graph)
- [SPARC Methodology (wiki)](https://github.com/ruvnet/ruflo/wiki/SPARC-Methodology)
- [Ruflo: Building Self-Learning Agent Swarms with Federation (Starlog)](https://starlog.is/articles/ai-agents/ruvnet-ruflo/)
- [Ruflo orchestration of AI agents (Nacho Conesa)](https://nachoconesa.com/blog/ruflo-orquestacion-agentes-ia?lang=en)
- [One Open Source Project a Day No.55: RuFlo (DEV)](https://dev.to/wonderlab/one-open-source-project-a-day-no-55-ruflo-a-multi-agent-orchestration-engine-for-the-ai-swarm-1fnp)
