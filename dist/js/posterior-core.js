// Line-by-line port of upstream mast3r_slam/functional_graph/local_posterior.py
// (commit f0426fa). Defaults are those of OnlineFunctionalState.
export const DEFAULTS = Object.freeze({
  decay: 0.95,
  min_support_frames: 3,
  stable_margin: 1.5,
  history_size: 6,
  max_switches: 1,
  recent_consistency_frames: 3,
  unresolved_margin: 0.5,
  unresolved_frames: 5,
});

const ranked = map => [...map.entries()].sort((a, b) => b[1] - a[1]);

export class LocalParentPosterior {
  constructor() {
    this.scores = new Map();
    this.supportFrames = new Map();
    this.top1 = null;
    this.top2 = null;
    this.margin = 0;
    this.latestMargin = 0;
    this.ambiguity = 0;
    this.stable = null;
    this.topHistory = [];
    this.frameHistory = [];
  }

  update(frame, evidence, p = DEFAULTS) {
    const now = ranked(new Map(Object.entries(evidence)));
    this.latestMargin = (now[0]?.[1] ?? 0) - (now[1]?.[1] ?? 0);
    for (const id of [...this.scores.keys()]) {
      const value = this.scores.get(id) * p.decay;
      if (value < 1e-6) this.scores.delete(id);
      else this.scores.set(id, value);
    }
    for (const [id, score] of Object.entries(evidence)) {
      this.scores.set(id, (this.scores.get(id) ?? 0) + Number(score));
      if (!this.supportFrames.has(id)) this.supportFrames.set(id, []);
      const frames = this.supportFrames.get(id);
      if (!frames.length || frames.at(-1) !== frame) frames.push(frame);
    }
    const all = ranked(this.scores);
    this.top1 = all[0]?.[0] ?? null;
    this.top2 = all[1]?.[0] ?? null;
    this.margin = (all[0]?.[1] ?? 0) - (all[1]?.[1] ?? 0);
    this.topHistory.push(this.top1);
    if (this.topHistory.length > p.history_size) this.topHistory = this.topHistory.slice(-p.history_size);
    this.frameHistory.push(frame);
    if (this.frameHistory.length > p.history_size) this.frameHistory = this.frameHistory.slice(-p.history_size);
    const unstable = !this.stableNow(p);
    this.ambiguity = this.top1 !== null && this.top2 !== null && unstable ? this.ambiguity + 1 : 0;
    if (!unstable && this.top1 !== null && this.stable !== this.top1) this.stable = this.top1;
  }

  supportCount(id) {
    return id === null ? 0 : (this.supportFrames.get(id)?.length ?? 0);
  }

  recentSupportCount(id, window) {
    if (id === null) return 0;
    const frames = this.supportFrames.get(id) ?? [];
    if (!frames.length) return 0;
    if (!this.frameHistory.length) return Math.min(frames.length, window);
    const cutoff = this.frameHistory.at(-1) - Math.max(1, window) + 1;
    return frames.filter(f => f >= cutoff).length;
  }

  recentSwitchCount(window) {
    let history = this.topHistory.filter(id => id !== null);
    if (window > 0) history = history.slice(-window);
    let switches = 0;
    for (let i = 1; i < history.length; i++) if (history[i] !== history[i - 1]) switches++;
    return switches;
  }

  recentTopConsistent(window) {
    if (window <= 1) return this.top1 !== null;
    const history = this.topHistory.slice(-window);
    if (history.length < window || history.some(id => id === null)) return false;
    return new Set(history).size === 1;
  }

  // Each check mirrors one early return of _is_current_top1_stable.
  checks(p = DEFAULTS) {
    const id = this.top1;
    return [
      ['support', id !== null && this.supportCount(id) >= p.min_support_frames],
      ['recent', id !== null && this.recentSupportCount(id, Math.max(p.min_support_frames, p.recent_consistency_frames)) >= p.recent_consistency_frames],
      ['margin', this.margin >= p.stable_margin],
      ['step', this.top2 === null || this.latestMargin >= p.stable_margin / Math.max(1, p.min_support_frames)],
      ['switches', this.recentSwitchCount(Math.max(p.min_support_frames + 1, p.recent_consistency_frames + 1)) <= p.max_switches],
      ['consistent', this.recentTopConsistent(p.recent_consistency_frames)],
    ];
  }

  stableNow(p = DEFAULTS) {
    return this.top1 !== null && this.checks(p).every(([, ok]) => ok);
  }

  unresolved(p = DEFAULTS) {
    const effective = this.top2 !== null ? this.latestMargin : this.margin;
    return this.stable === null && this.top1 !== null && this.top2 !== null
      && effective <= p.unresolved_margin && this.ambiguity >= p.unresolved_frames;
  }

  commitReady(p = DEFAULTS) {
    if (this.stable === null || this.stable !== this.top1) return false;
    if (this.unresolved(p)) return false;
    return this.stableNow(p);
  }
}
