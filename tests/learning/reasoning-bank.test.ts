import { describe, it, expect } from 'bun:test';

import {
  reuseScore,
  recencyBoost,
  feedbackQuality,
  assignTier,
  isExpired,
  evaluateForReasoningBank,
  rankByReuse,
  TIER_TTL_MS,
  EMPTY_FEEDBACK,
  type ScorableObservation,
  type FeedbackSignals,
} from '../../src/services/learning/reasoning-bank.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = 1_700_000_000_000; // fixed epoch — keep tests deterministic

function obs(partial: Partial<ScorableObservation>): ScorableObservation {
  return {
    id: 1,
    type: 'decision',
    createdAtEpoch: NOW,
    relevanceCount: 0,
    ...partial,
  };
}

function fb(partial: Partial<FeedbackSignals>): FeedbackSignals {
  return { ...EMPTY_FEEDBACK, ...partial };
}

describe('recencyBoost', () => {
  it('is 1 for a fresh memory', () => {
    expect(recencyBoost(0)).toBe(1);
  });

  it('clamps negative ages (clock skew) to fresh', () => {
    expect(recencyBoost(-5000)).toBe(1);
  });

  it('halves at exactly one half-life', () => {
    expect(recencyBoost(14 * DAY, 14 * DAY)).toBeCloseTo(0.5, 10);
  });

  it('decays monotonically with age', () => {
    expect(recencyBoost(DAY)).toBeGreaterThan(recencyBoost(7 * DAY));
  });
});

describe('feedbackQuality', () => {
  it('is 0 with no signals', () => {
    expect(feedbackQuality(EMPTY_FEEDBACK)).toBe(0);
  });

  it('is positive when hits dominate', () => {
    expect(feedbackQuality(fb({ hit: 5, miss: 0 }))).toBeGreaterThan(0);
  });

  it('is negative when misses dominate', () => {
    expect(feedbackQuality(fb({ hit: 0, miss: 4 }))).toBeLessThan(0);
  });

  it('treats search/retrieval as weak positive evidence', () => {
    expect(feedbackQuality(fb({ search: 2, retrieval: 2 }))).toBeGreaterThan(0);
  });
});

describe('reuseScore', () => {
  it('stays within (0, 1)', () => {
    const s = reuseScore(obs({ relevanceCount: 100 }), fb({ hit: 50 }), NOW);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });

  it('rewards reuse: more relevance_count => higher score', () => {
    const low = reuseScore(obs({ relevanceCount: 0 }), EMPTY_FEEDBACK, NOW);
    const high = reuseScore(obs({ relevanceCount: 20 }), EMPTY_FEEDBACK, NOW);
    expect(high).toBeGreaterThan(low);
  });

  it('penalizes net-negative feedback', () => {
    const good = reuseScore(obs({}), fb({ hit: 5 }), NOW);
    const bad = reuseScore(obs({}), fb({ miss: 5 }), NOW);
    expect(good).toBeGreaterThan(bad);
  });

  it('decays as the memory ages', () => {
    const fresh = reuseScore(obs({ createdAtEpoch: NOW }), EMPTY_FEEDBACK, NOW);
    const old = reuseScore(obs({ createdAtEpoch: NOW - 60 * DAY }), EMPTY_FEEDBACK, NOW);
    expect(fresh).toBeGreaterThan(old);
  });
});

describe('assignTier', () => {
  it('keeps a brand-new unused edit in the working tier', () => {
    expect(assignTier(obs({ type: 'change' }), EMPTY_FEEDBACK, NOW)).toBe('working');
  });

  it('promotes a proven, positively-rated strategy to semantic', () => {
    const proven = obs({ type: 'bugfix', relevanceCount: 30, createdAtEpoch: NOW - DAY });
    expect(assignTier(proven, fb({ hit: 20, miss: 0 }), NOW)).toBe('semantic');
  });

  it('does NOT promote a non-strategy type to semantic even if highly reused', () => {
    const reusedChange = obs({ type: 'change', relevanceCount: 50 });
    expect(assignTier(reusedChange, fb({ hit: 30 }), NOW)).not.toBe('semantic');
  });
});

describe('isExpired', () => {
  it('expires a working memory after 1 hour', () => {
    expect(isExpired('working', 2 * HOUR)).toBe(true);
    expect(isExpired('working', 30 * 60 * 1000)).toBe(false);
  });

  it('never expires a semantic memory', () => {
    expect(isExpired('semantic', 10 * 365 * DAY)).toBe(false);
    expect(TIER_TTL_MS.semantic).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('evaluateForReasoningBank', () => {
  it('promotes a proven strategy', () => {
    const decision = evaluateForReasoningBank(
      obs({ type: 'decision', relevanceCount: 25, createdAtEpoch: NOW - DAY }),
      fb({ hit: 15 }),
      NOW,
    );
    expect(decision.promote).toBe(true);
    expect(decision.tier).toBe('semantic');
  });

  it('refuses to promote net-negative feedback', () => {
    const decision = evaluateForReasoningBank(
      obs({ type: 'bugfix', relevanceCount: 25 }),
      fb({ hit: 1, miss: 10 }),
      NOW,
    );
    expect(decision.promote).toBe(false);
    expect(decision.reason).toContain('negative');
  });

  it('refuses to promote a transient change', () => {
    const decision = evaluateForReasoningBank(
      obs({ type: 'change', relevanceCount: 25 }),
      fb({ hit: 15 }),
      NOW,
    );
    expect(decision.promote).toBe(false);
    expect(decision.reason).toContain('not a durable strategy');
  });
});

describe('rankByReuse', () => {
  it('orders proven strategies above fresh-but-unused ones', () => {
    const ranked = rankByReuse(
      [
        { obs: obs({ id: 1, type: 'change', relevanceCount: 0, createdAtEpoch: NOW }) },
        { obs: obs({ id: 2, type: 'bugfix', relevanceCount: 40, createdAtEpoch: NOW - DAY }), feedback: fb({ hit: 25 }) },
      ],
      NOW,
    );
    expect(ranked[0].obs.id).toBe(2);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });
});
