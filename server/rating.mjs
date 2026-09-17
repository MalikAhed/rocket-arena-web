// Arena Team Elo v1. This is NOT Rocket League's unpublished MMR algorithm.
// Confidence is a provisional K-factor schedule, NOT a Bayesian posterior.
const tiers = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Champion', 'Grand Champion'];
const roman = ['I', 'II', 'III'];
export const DEFAULT_RATING_CONFIG = Object.freeze({
  version: 'arena-team-elo-v1', initial: 1000, initialUncertainty: 350,
  minimumUncertainty: 60, uncertaintyDecay: 0.96, baseK: 24, provisionalK: 96,
  logisticScale: 400, placements: 10,
  ranks: [
    ...tiers.flatMap((tier, group) => roman.map((subtier, sub) => {
      const index = group * 3 + sub;
      return { id: `${tier.toLowerCase().replaceAll(' ', '-')}-${sub + 1}`, name: `${tier} ${subtier}`,
        threshold: index === 0 ? 0 : 300 + index * 100, divisions: 4, badge: index + 1 };
    })),
    { id: 'supersonic-legend', name: 'Supersonic Legend', threshold: 2400, divisions: 1, badge: 22 },
  ],
});
export function validateRatingConfig(c) {
  for (const key of ['initial', 'initialUncertainty', 'minimumUncertainty', 'uncertaintyDecay', 'baseK', 'provisionalK', 'logisticScale', 'placements']) {
    if (!Number.isFinite(c[key]) || c[key] <= 0) throw new Error(`Invalid rating configuration: ${key}`);
  }
  if (!/^[a-z0-9-]{1,80}$/.test(c.version) || c.minimumUncertainty >= c.initialUncertainty || c.baseK > c.provisionalK || c.uncertaintyDecay > 1 || !Number.isInteger(c.placements)) throw new Error('Invalid rating configuration');
  if (!Array.isArray(c.ranks) || c.ranks.length < 2 || c.ranks[0].threshold !== 0) throw new Error('Invalid rank thresholds');
  c.ranks.forEach((r, i) => {
    if (!Number.isFinite(r.threshold) || i && r.threshold <= c.ranks[i - 1].threshold || !Number.isInteger(r.divisions) || r.divisions < 1 || r.divisions > 4 || typeof r.name !== 'string' || r.name.length > 40 || !/^[a-z0-9-]{1,50}$/.test(r.id) || !Number.isInteger(r.badge) || r.badge < 1 || r.badge > 22) throw new Error('Invalid rank definition');
  });
  return c;
}
export function initialRating(c = DEFAULT_RATING_CONFIG) { return { mu: c.initial, uncertainty: c.initialUncertainty, games: 0 }; }
export function rankOf(rating, c = DEFAULT_RATING_CONFIG) {
  if (rating.games < c.placements) return { id: 'unranked', name: 'Unranked', division: null, badge: 0, placements: rating.games, placementTotal: c.placements, index: -1 };
  let index = c.ranks.findLastIndex(rank => rating.mu >= rank.threshold);
  index = Math.max(0, index);
  const rank = c.ranks[index], ceiling = c.ranks[index + 1]?.threshold ?? Infinity;
  const division = index === c.ranks.length - 1 ? 1 : Math.min(rank.divisions, 1 + Math.floor((rating.mu - rank.threshold) / ((ceiling - rank.threshold) / rank.divisions)));
  return { ...rank, division, index, placements: c.placements, placementTotal: c.placements };
}
export function rateTeams(players, winner, c = DEFAULT_RATING_CONFIG, casual = false) {
  if (![0, 1].includes(winner) || ![2, 4, 6].includes(players.length) || new Set(players.map(p => p.id)).size !== players.length) throw new Error('Invalid rating roster');
  const teams = [0, 1].map(team => players.filter(p => p.team === team));
  if (teams.some(team => team.length !== players.length / 2)) throw new Error('Unbalanced rating roster');
  for (const p of players) if (!Number.isFinite(p.mu) || p.mu < 0 || !Number.isFinite(p.uncertainty) || !Number.isInteger(p.games) || p.games < 0) throw new Error('Invalid rating');
  const means = teams.map(team => team.reduce((sum, p) => sum + p.mu, 0) / team.length);
  const expectation = 1 / (1 + 10 ** ((means[1] - means[0]) / c.logisticScale));
  return players.map(p => {
    const expected = p.team === 0 ? expectation : 1 - expectation;
    const confidence = Math.max(0, Math.min(1, (p.uncertainty - c.minimumUncertainty) / (c.initialUncertainty - c.minimumUncertainty)));
    const k = casual ? c.baseK : c.baseK + (c.provisionalK - c.baseK) * confidence;
    const before = { mu: p.mu, uncertainty: p.uncertainty, games: p.games };
    const after = { mu: Math.round(Math.max(0, p.mu + k * ((p.team === winner ? 1 : 0) - expected)) * 100) / 100,
      uncertainty: Math.max(c.minimumUncertainty, p.uncertainty * c.uncertaintyDecay), games: p.games + 1 };
    return { id: p.id, before, after, delta: Math.round((after.mu - before.mu) * 100) / 100,
      previousRank: rankOf(before, c), rank: rankOf(after, c) };
  });
}
