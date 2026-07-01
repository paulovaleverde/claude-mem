/**
 * ReasoningBank — feedback-driven memory tiering & strategy promotion.
 *
 * PROOF OF CONCEPT. Pure, dependency-free scoring functions. Nothing here
 * touches the database or the worker at runtime yet; it is designed to be
 * wired into `SearchRoutes` ranking and the SessionEnd pipeline later.
 *
 * --- Why this exists ---
 * Inspired by the "Ruflo" (ex-"Claude Flow") project, whose agents appear to
 * "learn and grow together". The mechanism behind that is not magic: it is a
 * tiered memory (working / episodic / semantic) plus a "ReasoningBank" that
 * persists *successful* strategies so current and future agents retrieve them
 * instead of rediscovering solutions, ranked by a feedback loop.
 *
 * claude-mem already ships the foundations this needs:
 *   - `observations.relevance_count`  (migration009) — how often a memory was reused
 *   - `observation_feedback`          (migration008) — hit/miss/search/retrieval signals,
 *                                       described in-code as the "foundation for future
 *                                       Thompson Sampling optimization"
 *   - `observations.type`             — decision | bugfix | feature | refactor | discovery | change
 *   - `created_at_epoch`              — recency
 *
 * This module turns those raw signals into (a) a normalized reuse score, (b) a
 * memory tier with a TTL, and (c) a promotion decision for the ReasoningBank.
 *
 * See docs/research/ruflo-collective-learning.md for the full analysis.
 */

/** Ruflo-style temporal tiers. The tier controls retention (TTL) and ranking boost. */
export type MemoryTier = 'working' | 'episodic' | 'semantic';

/** Observation types claude-mem already assigns (src/types/database.ts). */
export type ObservationType =
  | 'decision'
  | 'bugfix'
  | 'feature'
  | 'refactor'
  | 'discovery'
  | 'change';

/**
 * Feedback signal counts for a single observation, aggregated from the
 * `observation_feedback` table by `signal_type`.
 */
export interface FeedbackSignals {
  /** Observation was injected/returned and turned out useful. */
  hit: number;
  /** Observation was surfaced but discarded / not useful. */
  miss: number;
  /** Observation matched a search query. */
  search: number;
  /** Observation was explicitly retrieved (e.g. timeline / by-id). */
  retrieval: number;
}

/** Minimal projection of an observation needed for scoring. */
export interface ScorableObservation {
  id: number;
  type: ObservationType | string;
  /** `observations.created_at_epoch` (ms since epoch). */
  createdAtEpoch: number;
  /** `observations.relevance_count` — reuse counter. */
  relevanceCount: number;
}

export const EMPTY_FEEDBACK: FeedbackSignals = { hit: 0, miss: 0, search: 0, retrieval: 0 };

/** TTLs mirror Ruflo's documented tiers. `semantic` never expires. */
export const TIER_TTL_MS: Record<MemoryTier, number> = {
  working: 60 * 60 * 1000, // 1 hour
  episodic: 7 * 24 * 60 * 60 * 1000, // 7 days
  semantic: Number.POSITIVE_INFINITY, // indefinite
};

/**
 * Observation types that represent *durable knowledge* worth promoting to the
 * ReasoningBank (the "this worked, reuse it" set). Transient edits ('change')
 * are intentionally excluded.
 */
export const STRATEGY_TYPES: ReadonlySet<string> = new Set<string>([
  'decision',
  'bugfix',
  'discovery',
]);

/** Scoring weights. Exposed so callers/tests can tune without code edits. */
export interface ScoringWeights {
  /** Weight on log-scaled reuse count. */
  reuse: number;
  /** Weight on net feedback (hit - miss). */
  feedback: number;
  /** Weight on the recency boost in [0,1]. */
  recency: number;
  /** Half-life (ms) controlling recency decay. Default: 14 days. */
  recencyHalfLifeMs: number;
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  reuse: 1.0,
  feedback: 0.8,
  recency: 0.6,
  recencyHalfLifeMs: 14 * 24 * 60 * 60 * 1000,
};

/** Logistic squash to keep the final score in (0, 1). */
function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Exponential recency boost in (0, 1]. 1 when fresh, halving every half-life.
 * Clamps negative ages (clock skew) to "fresh".
 */
export function recencyBoost(ageMs: number, halfLifeMs: number = DEFAULT_WEIGHTS.recencyHalfLifeMs): number {
  if (ageMs <= 0) return 1;
  return Math.pow(0.5, ageMs / halfLifeMs);
}

/**
 * Net feedback quality in roughly [-1, 1]: positive when hits dominate misses.
 * `search`/`retrieval` count as weak positive evidence (the memory was at least
 * relevant enough to surface).
 */
export function feedbackQuality(f: FeedbackSignals): number {
  const positive = f.hit + 0.25 * f.search + 0.25 * f.retrieval;
  const negative = f.miss;
  const total = positive + negative;
  if (total === 0) return 0;
  return (positive - negative) / total;
}

/**
 * Combined reuse/recall score in (0, 1). Higher = more worth surfacing.
 * This is the value a ranking layer would multiply into its relevance score.
 */
export function reuseScore(
  obs: ScorableObservation,
  feedback: FeedbackSignals = EMPTY_FEEDBACK,
  nowEpoch: number,
  weights: ScoringWeights = DEFAULT_WEIGHTS,
): number {
  const ageMs = nowEpoch - obs.createdAtEpoch;
  const reuseTerm = weights.reuse * Math.log1p(Math.max(0, obs.relevanceCount));
  const feedbackTerm = weights.feedback * feedbackQuality(feedback);
  const recencyTerm = weights.recency * recencyBoost(ageMs, weights.recencyHalfLifeMs);
  // Center the logistic so a brand-new, unused observation lands near ~0.4
  // rather than 0.5, leaving headroom for proven memories to climb.
  return logistic(reuseTerm + feedbackTerm + recencyTerm - 1);
}

/** Promotion thresholds for tier assignment, on the reuseScore scale (0..1). */
export const SEMANTIC_THRESHOLD = 0.7;
export const EPISODIC_THRESHOLD = 0.55;

/**
 * Assign a memory tier from the observation's score and nature.
 *
 * Unlike a pure age-based TTL, this *promotes by proven value*: a heavily reused,
 * positively-signaled strategy is kept in the `semantic` tier (indefinite, ranked
 * high) even though a brand-new edit of the same age would only be `working`.
 * This is the core of how Ruflo memories "grow" instead of just aging out.
 */
export function assignTier(
  obs: ScorableObservation,
  feedback: FeedbackSignals = EMPTY_FEEDBACK,
  nowEpoch: number,
  weights: ScoringWeights = DEFAULT_WEIGHTS,
): MemoryTier {
  const score = reuseScore(obs, feedback, nowEpoch, weights);
  if (score >= SEMANTIC_THRESHOLD && STRATEGY_TYPES.has(obs.type)) return 'semantic';
  if (score >= EPISODIC_THRESHOLD) return 'episodic';
  return 'working';
}

/** Has an observation outlived its tier's TTL and become eligible for pruning? */
export function isExpired(tier: MemoryTier, ageMs: number): boolean {
  return ageMs > TIER_TTL_MS[tier];
}

export interface PromotionDecision {
  promote: boolean;
  tier: MemoryTier;
  score: number;
  reason: string;
}

/**
 * Decide whether an observation should enter the ReasoningBank — i.e. be
 * persisted as a reusable, cross-session strategy. This is what a SessionEnd
 * pipeline would call to "save successful strategies for future agents".
 */
export function evaluateForReasoningBank(
  obs: ScorableObservation,
  feedback: FeedbackSignals = EMPTY_FEEDBACK,
  nowEpoch: number,
  weights: ScoringWeights = DEFAULT_WEIGHTS,
): PromotionDecision {
  const score = reuseScore(obs, feedback, nowEpoch, weights);
  const tier = assignTier(obs, feedback, nowEpoch, weights);

  if (!STRATEGY_TYPES.has(obs.type)) {
    return { promote: false, tier, score, reason: `type "${obs.type}" is not a durable strategy` };
  }
  if (feedbackQuality(feedback) < 0) {
    return { promote: false, tier, score, reason: 'net-negative feedback' };
  }
  if (tier !== 'semantic') {
    return { promote: false, tier, score, reason: `score ${score.toFixed(2)} below semantic threshold` };
  }
  return { promote: true, tier, score, reason: 'proven, positively-rated strategy' };
}

/**
 * Rank a batch of observations by reuse score (descending). Pure helper a
 * ranking layer can use to re-order hybrid (FTS5 + Chroma) search results.
 */
export function rankByReuse(
  items: Array<{ obs: ScorableObservation; feedback?: FeedbackSignals }>,
  nowEpoch: number,
  weights: ScoringWeights = DEFAULT_WEIGHTS,
): Array<{ obs: ScorableObservation; score: number; tier: MemoryTier }> {
  return items
    .map(({ obs, feedback }) => ({
      obs,
      score: reuseScore(obs, feedback ?? EMPTY_FEEDBACK, nowEpoch, weights),
      tier: assignTier(obs, feedback ?? EMPTY_FEEDBACK, nowEpoch, weights),
    }))
    .sort((a, b) => b.score - a.score);
}
