# Implantação de aprendizado coletivo (estilo Ruflo) no nosso fluxo

> Avaliação de viabilidade: podemos rodar, no **nosso** trabalho, o processo de
> agentes que compartilham conhecimento e evoluem juntos?
> **Resposta curta: sim — e a maior parte já está implantada.** O que falta é a
> camada de *aprendizado por feedback*. Este documento detalha o diagnóstico,
> o que falta, como funciona, e — principalmente — como manter isso seguro.

---

## Premissa que muda tudo (leia primeiro)

A "autonomia" do aprendizado coletivo **não é autonomia de ação**. O que o
processo aprende e compartilha é **o que lembrar e em que ordem mostrar** —
não *o que executar sem pedir*. A distinção:

| O aprendizado faz | O aprendizado **não** faz |
|-------------------|---------------------------|
| Reordena memórias por utilidade comprovada | Executa comandos sozinho |
| Promove estratégias vencedoras para reuso | Commita/faz push sem verificação |
| Prioriza o "núcleo aprendido" do projeto | Toma decisões irreversíveis |
| Sugere o que já funcionou antes | Substitui o gate humano |

Ou seja: os agentes ficam **mais bem informados**, não **menos supervisionados**.
Isso é o que torna a implantação segura (detalhado na seção 4).

---

## 1. Diagnóstico — onde estamos agora

### 1.1 Sim, já temos uma equipe de agentes

Vocês descreveram exatamente o que o projeto já faz: "várias skills, com temas
distintos, que disparam agentes distintos". Isso já existe:

| Papel | Skill | O que dispara |
|-------|-------|---------------|
| **Orquestrador de execução** | `do` | Subagentes: Implementation, Verification, Anti-pattern, Code-Quality, Commit, Branch/Sync |
| **Orquestrador de planejamento** | `make-plan` | Planos faseados + descoberta de docs |
| **Recuperação de memória** | `mem-search` | Busca cross-session (já tem `orderBy: "relevance"`) |
| **Exploração** | `smart-explore` | Varredura de código |
| **"Cérebros" por tema** | `knowledge-agent` | Corpora filtrados ("tudo sobre hooks", "decisões do mês") |
| **Relatórios** | `timeline-report` | Linha do tempo de observações |
| **Utilitário** | `version-bump` | Versionamento |

O `do` (`plugin/skills/do/SKILL.md`) é literalmente um orquestrador que delega
*todo* o trabalho a subagentes especializados, com gate de verificação antes de
commitar. **Isso é a estrutura "Queen-led" do Ruflo, em menor escala.**

### 1.2 Sim, já temos compartilhamento de conhecimento

O sharing acontece pela base de observações — escrita por uns agentes, lida por
outros:

```
ESCRITA (todo agente alimenta)              LEITURA (todo agente consome)
─────────────────────────────              ─────────────────────────────
5 hooks → worker → observations DB    →    mem-search (search/relevance)
         + Chroma (vetorial)          →    context injection (SessionStart)
         + observation_feedback       →    knowledge-agent (corpora por tema)
```

Toda observação gerada por um subagente vira, automaticamente, conhecimento
pesquisável por **qualquer agente futuro** — em qualquer sessão. É exatamente o
"aprendem juntos" do vídeo, só que **sem o loop de reforço** que faz o bom
subir e o ruim descer.

### 1.3 Maturidade vs. Ruflo

| Capacidade | Status | Evidência |
|------------|--------|-----------|
| Time de agentes (orquestração) | ✅ **Pronto** | skill `do` |
| Memória compartilhada persistente | ✅ **Pronto** | observations DB + Chroma |
| "Cérebros" por tema | ✅ **Pronto** | skill `knowledge-agent` |
| Sinais de feedback (coleta) | 🟡 **Tabela existe, não usada** | `observation_feedback` |
| Contador de reuso | 🟡 **Coluna existe, não rankeia** | `relevance_count` |
| Ranking por feedback | ❌ **Falta** | → POC Fase 1 desta branch |
| Tiers de memória (decay) | ❌ **Falta** | → Fase 2 |
| Promoção de estratégia (ReasoningBank) | ❌ **Falta** | → POC Fase 1 |
| Grafo causal | ❌ **Falta** | → Fase 3 |
| Federação entre máquinas | ⛔ **Fora de escopo (por segurança)** | seção 4 |

**Conclusão do diagnóstico:** estamos a ~70-80% do caminho. O que falta não é
infraestrutura — é a **camada de aprendizado** que transforma memória passiva em
memória que melhora sozinha.

---

## 2. O que precisamos para implantação

### 2.1 Nada novo para instalar
Bun, uv e o worker (porta 37777) já são requisitos do projeto. A camada de
aprendizado é código sobre dados que já coletamos. **Custo de infra: zero.**

### 2.2 As três entregas técnicas

| Fase | O que entra | Esforço | Risco |
|------|-------------|---------|-------|
| **1. ReasoningBank** | Plugar `reuseScore()` no `orderBy="relevance"` do `mem-search`; gravar sinais de feedback quando uma observação injetada é de fato usada; promover estratégias no hook `Stop` | Baixo (POC já feita) | Baixo (funções puras, testadas) |
| **2. Tiers + decay** | Coluna `tier` em `observations`; job que reavalia tier e poda working/episodic expirados | Médio | Baixo |
| **3. Grafo causal** | Tabela `observation_edges`; pathfinding "decisão → efeito" | Alto | Médio |

### 2.3 O elo que falta para "fechar o loop": coletar feedback de verdade
Hoje `observation_feedback` está vazia na prática. Para o aprendizado funcionar,
precisamos **gravar sinais** nos pontos onde já sabemos se uma memória ajudou:
- `mem-search` retornou e o agente **usou** a observação → sinal `hit`
- contexto injetado no `SessionStart` foi **referenciado** → `hit`
- observação apareceu mas foi **descartada** → `miss`
- `knowledge-agent` citou a observação na resposta → `retrieval`

Sem isso, o `reuseScore` cai para "só recência + reuso". Com isso, ele aprende.

---

## 3. Como fica o funcionamento (o ciclo completo)

```
 ┌─────────────────────────────────────────────────────────────────────┐
 │  1. Orquestrador (skill `do`/`make-plan`) recebe a tarefa            │
 │     └─ dispara subagentes por TEMA (impl, verify, anti-pattern...)   │
 ├─────────────────────────────────────────────────────────────────────┤
 │  2. Cada subagente, ao trabalhar, gera observações (hooks → DB)      │
 │     └─ tudo vira conhecimento compartilhado, pesquisável             │
 ├─────────────────────────────────────────────────────────────────────┤
 │  3. Próxima tarefa: antes de agir, agente consulta mem-search /      │
 │     knowledge-agent → recupera o que JÁ funcionou (não redescobre)   │
 ├─────────────────────────────────────────────────────────────────────┤
 │  4. Feedback: quando uma memória recuperada é usada/descartada,      │
 │     grava sinal hit/miss em observation_feedback                     │
 ├─────────────────────────────────────────────────────────────────────┤
 │  5. reuseScore() reordena: o que funcionou sobe, o que falhou desce  │
 │     evaluateForReasoningBank() promove estratégias provadas a        │
 │     tier "semantic" (permanente, topo do ranking)                    │
 ├─────────────────────────────────────────────────────────────────────┤
 │  6. Na sessão seguinte, os agentes começam JÁ sabendo o melhor       │
 │     caminho → "evoluem juntos". Volta ao passo 1.                    │
 └─────────────────────────────────────────────────────────────────────┘
```

O ganho prático: um padrão de correção descoberto pelo subagente de bugfix passa
a ser sugerido, primeiro, ao subagente de implementação da próxima feature —
sem ninguém reescrever a solução.

---

## 4. Segurança — como manter controle de um processo que "aprende sozinho"

Esta é a pergunta mais importante. Sete camadas de proteção, da mais forte para
a mais fina:

### 4.1 Autonomia é de RANKING, não de AÇÃO (a defesa principal)
O aprendizado nunca executa nada. Ele muda *quais memórias aparecem e em que
ordem*. As ações continuam atrás dos mesmos gates de sempre — e o skill `do` já
exige verificação **antes** de commitar ("Don't commit before verification
passes"). Mantemos a regra: **sugerir, não agir**.

### 4.2 Gate humano nos pontos irreversíveis
Commit, push, deleção, qualquer coisa "outward-facing" continua pedindo
confirmação. A memória torna o agente mais informado para *propor*; quem aprova
o irreversível é o humano (ou um gate explícito).

### 4.3 Privacidade na borda (já existe)
A tag `<private>...</private>` é removida **no hook**, antes dos dados chegarem
ao worker/DB (`src/utils/tag-stripping.ts`). O que é privado nunca entra na
memória compartilhada — logo, nunca é aprendido nem promovido.

### 4.4 Anti-envenenamento de feedback (poisoning)
Risco real: uma estratégia ruim ser promovida por sinais falsos. Mitigações,
já parcialmente na POC:
- **Feedback líquido negativo bloqueia promoção** (`evaluateForReasoningBank`
  recusa `feedbackQuality < 0`).
- Exigir **N sinais positivos independentes** (de sessões distintas), não um só.
- **Decaimento temporal**: estratégia que parou de ser usada perde posto.
- **Tier de quarentena**: nada entra em `semantic` sem passar por `episodic`.
- **Override humano**: poder rebaixar/banir uma observação manualmente.

### 4.5 Isolamento de escopo (sem vazamento entre projetos)
Cada projeto tem coleção própria (`cm__{project}` no Chroma; filtro `project` no
SQLite). **A federação entre máquinas fica deliberadamente fora de escopo** — é
o recurso mais chamativo do Ruflo, mas é também o maior vetor de vazamento.
Enquanto não houver necessidade clara + infra de segurança, ficamos
single-machine/per-project.

### 4.6 Auditabilidade total (memória local + proveniência)
Tudo é local (`~/.claude-mem/claude-mem.db`) e rastreável: cada observação tem
`created_at`, `generated_by_model`, `content_hash` (dedup) e `discovery_tokens`
(custo). Dá para auditar *o que* foi aprendido, *quando*, *por qual modelo* e a
*que custo*. Nada sai da máquina sem ação explícita.

### 4.7 Fail-safe e kill switch
Os hooks saem com exit 0 e a memória é "fire-and-forget" (timeout 2s) — se a
camada de aprendizado falhar, **o trabalho real não trava**. E como é tudo
SQLite local, desligar/limpar/reverter é trivial (drop da coluna `tier`, limpar
`observation_feedback`, etc.).

---

## 5. Outras questões relevantes

### 5.1 O verdadeiro "membro permanente do time" é a memória
Os subagentes são **efêmeros** (nascem e morrem por tarefa). Quem persiste e
"evolui" é a **base de memória**. Então não estamos contratando uma equipe fixa
de agentes — estamos cultivando um **acervo** que cada agente efêmero consulta e
enriquece. Isso é mais barato e mais seguro que manter agentes vivos.

### 5.2 Cold-start e drift
- **Cold-start**: nas primeiras sessões há pouco a aprender; o `reuseScore` cai
  para recência. Normal — o valor cresce com o uso.
- **Drift de corpus**: `knowledge-agent` precisa de `rebuild_corpus` quando há
  muitas observações novas. Vale automatizar o rebuild periódico.

### 5.3 Como medir se está funcionando (métrica de avaliação)
Já temos os dados para medir ROI: **hit-rate** (quantas memórias recuperadas
foram usadas) e **discovery_tokens economizados** (reuso vs. redescoberta).
Recomendo um painel simples no viewer (`http://localhost:37777`) com esses dois
números antes/depois da Fase 1.

### 5.4 Governança do que é "estratégia"
`STRATEGY_TYPES` hoje = {decision, bugfix, discovery}. Isso é uma decisão de
produto: define o que entra no ReasoningBank. Vale revisar com o time — p.ex.,
incluir `refactor` ou não.

### 5.5 Recomendação final
1. **Aprovar a Fase 1** (POC já testada) e plugá-la no `orderBy="relevance"`.
2. **Instrumentar os sinais de feedback** (seção 2.3) — é o elo que falta.
3. **Medir hit-rate por 2 semanas** antes de investir nas Fases 2/3.
4. **Manter "sugerir, não agir"** e a federação fora de escopo até haver caso de
   uso + revisão de segurança.

> Em uma frase: **não precisamos construir uma equipe de agentes autônomos —
> precisamos ensinar a memória que já temos a lembrar melhor do que funcionou,
> mantendo o humano no comando das ações.**
