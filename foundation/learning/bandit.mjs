/* foundation/learning/bandit.mjs — PSY learning foundation (P3)
 * Contextual bandit with abstention, ported to dependency-free ESM so the
 * no-bundler device can consume it. Semantics mirror foundation/learning/
 * policy.ts + learner.ts + store.ts (the TypeScript reference):
 *   - epsilon-greedy exploitation with cold-start exploration
 *   - DO_NOTHING is always a legal candidate (abstention)
 *   - records keyed by (context, role, action) with avg reward + trials
 *   - full JSON round-trip (toJSON / fromJSON)
 * Determinism rule: NO Math.random, NO Date.now. The RNG is injected per
 * decide() call — the device passes a mulberry32 stream derived from
 * projectSeed + decision counter.
 */

export class BanditError extends Error {
  constructor(msg) { super(msg); this.name = 'BanditError'; }
}

/* Stable string key for an action object (custom fields allowed).
 * Keys are sorted so {type:'layer-toggle',track:2} serializes identically
 * regardless of construction order. */
export function actionKey(action) {
  if (!action || typeof action !== 'object') throw new BanditError('action must be an object');
  const keys = Object.keys(action).sort();
  const parts = [];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i], v = action[k];
    parts.push(k + '=' + (v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v))));
  }
  return parts.join('|');
}

/* Stable string key for a context object (same sorted-fields rule). */
export function contextKey(ctx) {
  if (!ctx || typeof ctx !== 'object') throw new BanditError('context must be an object');
  const keys = Object.keys(ctx).sort();
  const parts = [];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i], v = ctx[k];
    parts.push(k + '=' + (typeof v === 'object' ? JSON.stringify(v) : String(v)));
  }
  return parts.join('|');
}

function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

/* ---------------- LearningStore ----------------
 * Aggregated per-(context,role,action) records + raw experience log. */
export class LearningStore {
  constructor() { this.map = new Map(); this.experiences = []; }
  _key(ck, role, akey) { return ck + '::' + role + '::' + akey; }
  record(ck, role, action, reward, at) {
    if (typeof reward !== 'number' || !isFinite(reward)) throw new BanditError('reward must be a finite number');
    const akey = actionKey(action);
    const k = this._key(ck, role, akey);
    let rec = this.map.get(k);
    if (!rec) { rec = { contextKey: ck, role, actionKey: akey, action, trials: 0, sumReward: 0, avgReward: 0, lastAt: 0 }; this.map.set(k, rec); }
    rec.trials++; rec.sumReward += reward; rec.avgReward = rec.sumReward / rec.trials; rec.lastAt = at;
    this.experiences.push({ contextKey: ck, role, actionKey: akey, reward, at });
    return rec;
  }
  recordsFor(ck, role) {
    const out = [];
    const pre = ck + '::' + role + '::';
    for (const rec of this.map.values()) if (rec.actionKey.indexOf(pre) === 0) out.push(rec);
    return out;
  }
  findRecord(ck, role, action) {
    return this.map.get(this._key(ck, role, actionKey(action))) || null;
  }
  allRecords() { return Array.from(this.map.values()); }
  get size() { return this.experiences.length; }
  get uniqueRecords() { return this.map.size; }
  reset() { this.map.clear(); this.experiences.length = 0; }
  toJSON() { return { experiences: this.experiences.slice(), records: this.allRecords() }; }
  static fromJSON(data) {
    if (!data || !Array.isArray(data.experiences) || !Array.isArray(data.records)) throw new BanditError('bad store payload');
    const s = new LearningStore();
    for (let i = 0; i < data.experiences.length; i++) s.experiences.push(data.experiences[i]);
    for (let i = 0; i < data.records.length; i++) {
      const rec = data.records[i];
      if (!rec || !rec.actionKey) throw new BanditError('bad record payload');
      s.map.set(rec.contextKey + '::' + rec.role + '::' + rec.actionKey, rec);
    }
    return s;
  }
}

/* ---------------- BanditPolicy ----------------
 * decide() returns {action, reason, confidence, expectedReward}.
 * reason ∈ 'cold-start' | 'explore' | 'exploit' | 'abstain'.
 * DO_NOTHING ({type:'do-nothing'}) is always appended to candidates. */
export const DO_NOTHING = Object.freeze({ type: 'do-nothing' });

export class BanditPolicy {
  constructor(opts) {
    const o = opts || {};
    this.epsilon = o.epsilon != null ? o.epsilon : 0.1;
    this.minTrials = o.minTrials != null ? o.minTrials : 3;
    this.abstainThreshold = o.abstainThreshold != null ? o.abstainThreshold : 0.1;
    this.confidenceGrowth = o.confidenceGrowth != null ? o.confidenceGrowth : 0.1;
    if (this.epsilon < 0 || this.epsilon > 1) throw new BanditError('epsilon must be in [0,1]');
  }
  confidence(trials) { return 1 - 1 / (1 + trials * this.confidenceGrowth); }
  decide(ck, role, candidates, store, rng) {
    if (typeof rng !== 'function') throw new BanditError('rng(required) — determinism rule: inject a seeded RNG');
    const all = candidates.slice();
    all.push(DO_NOTHING);
    const scored = all.map((action) => ({ action, record: store.findRecord(ck, role, action) }));

    /* cold-start: nothing tried enough yet. Prefer REAL actions — abstention
     * belongs to the learned-reward path (abstain), not to exploration. */
    const tried = scored.filter((s) => s.record && s.record.trials >= this.minTrials);
    if (tried.length === 0) {
      let untried = scored.filter((s) => s.action.type !== 'do-nothing' && (!s.record || s.record.trials === 0));
      if (untried.length === 0) untried = scored.filter((s) => !s.record || s.record.trials === 0);
      if (untried.length > 0) {
        const pick = untried[Math.floor(rng() * untried.length)] || untried[0];
        return { action: pick.action, reason: 'cold-start', confidence: 0, expectedReward: null };
      }
      const least = scored.slice().sort((a, b) => (a.record ? a.record.trials : 0) - (b.record ? b.record.trials : 0))[0];
      return { action: least.action, reason: 'cold-start', confidence: this.confidence(least.record ? least.record.trials : 0), expectedReward: least.record ? least.record.avgReward : null };
    }

    /* exploration */
    if (rng() < this.epsilon) {
      const pick = scored[Math.floor(rng() * scored.length)] || scored[0];
      return { action: pick.action, reason: 'explore', confidence: this.confidence(pick.record ? pick.record.trials : 0), expectedReward: pick.record ? pick.record.avgReward : null };
    }

    /* exploitation */
    const best = tried.slice().sort((a, b) => b.record.avgReward - a.record.avgReward)[0];

    /* abstention: best reward below threshold → do nothing */
    if (best.record.avgReward < this.abstainThreshold && best.action.type !== 'do-nothing') {
      const dn = scored.find((s) => s.action.type === 'do-nothing');
      if (dn) return { action: DO_NOTHING, reason: 'abstain', confidence: clamp01(1 - best.record.avgReward), expectedReward: best.record.avgReward };
    }
    return { action: best.action, reason: 'exploit', confidence: this.confidence(best.record.trials), expectedReward: best.record.avgReward };
  }
}

/* ---------------- BanditLearner ----------------
 * Facade mirroring learning/learner.ts: decide + recordOutcome + stats +
 * serialization. decisions log is capped (decisionLogSize). */
export class BanditLearner {
  constructor(opts) {
    const o = opts || {};
    this.policy = new BanditPolicy(o);
    this.store = new LearningStore();
    this.decisions = [];
    this.decisionCount = 0;
    this.decisionLogSize = o.decisionLogSize != null ? o.decisionLogSize : 1000;
  }
  decide(context, role, candidates, opts) {
    const o = opts || {};
    const ck = contextKey(context);
    const rng = o.rng;
    const d = this.policy.decide(ck, role, candidates, this.store, rng);
    const decision = { action: d.action, reason: d.reason, confidence: d.confidence, expectedReward: d.expectedReward, contextKey: ck, role, at: o.at != null ? o.at : this.decisionCount };
    this.decisions.push(decision);
    if (this.decisions.length > this.decisionLogSize) this.decisions.shift();
    this.decisionCount++;
    return decision;
  }
  recordOutcome(context, role, action, reward, at) {
    const ck = contextKey(context);
    return this.store.record(ck, role, action, reward, at != null ? at : this.decisionCount);
  }
  stats() {
    const recs = this.store.allRecords();
    let top = null;
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i];
      if (r.actionKey === actionKey(DO_NOTHING)) continue;
      if (!top || r.avgReward > top.avgReward || (r.avgReward === top.avgReward && r.trials > top.trials)) top = r;
    }
    let dn = 0;
    for (let i = 0; i < this.decisions.length; i++) if (this.decisions[i].action.type === 'do-nothing') dn++;
    return {
      decisions: this.decisionCount,
      loggedDecisions: this.decisions.length,
      doNothing: dn,
      doNothingRate: this.decisions.length ? dn / this.decisions.length : 0,
      records: recs.length,
      experiences: this.store.size,
      topAction: top ? { actionKey: top.actionKey, avgReward: top.avgReward, trials: top.trials } : null,
    };
  }
  reset() { this.store.reset(); this.decisions.length = 0; this.decisionCount = 0; }
  toJSON() {
    return { v: 1, store: this.store.toJSON(), decisions: this.decisions.slice(), decisionCount: this.decisionCount, policy: { epsilon: this.policy.epsilon, minTrials: this.policy.minTrials, abstainThreshold: this.policy.abstainThreshold, confidenceGrowth: this.policy.confidenceGrowth } };
  }
  static fromJSON(data) {
    if (!data || data.v !== 1) throw new BanditError('bad learner payload (v)');
    const l = new BanditLearner(data.policy || {});
    const store = LearningStore.fromJSON(data.store);
    l.store = store;
    l.decisions = Array.isArray(data.decisions) ? data.decisions.slice() : [];
    l.decisionCount = typeof data.decisionCount === 'number' ? data.decisionCount : l.decisions.length;
    return l;
  }
}
