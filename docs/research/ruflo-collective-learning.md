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

<!-- A comparação com o claude-mem e a proposta de feature são preenchidas a seguir. -->
