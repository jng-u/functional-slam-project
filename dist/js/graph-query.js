export const LIGHT_QUERY = 'turn on the light';
const EXAMPLE_RELATION = 'open or close the microwave';
const normalize = text => (text ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const LIGHT_INTENT = /^(?:turn|switch) on (?:the )?lights?$/;
const SWITCH_LABEL = /^(?:(?:wall|light|power|toggle|rocker) )*switch$/;
const LIGHT_LABEL = /^(?:(?:ceiling|wall|desk|floor|pendant) )*(?:lights?|lamp|light fixture)$/;
const LIGHT_ACTION = /^(?:(?:controls?|toggles?)(?: (?:the )?(?:lights?|lamp))?|(?:turns?|switch(?:es)?) (?:on(?: (?:or )?off)?(?: (?:the )?(?:lights?|lamp))?|(?:the )?(?:lights?|lamp) on(?: (?:or )?off)?))$/;
const KOREAN_LIGHT_INTENT = /^불(?:을)? ?켜 ?줘$/;
const WATER_INTENT = /^(?:turn on (?:the )?water|물(?:을)? ?틀어 ?줘)$/;

const controlsLight = (src, dst, relation) =>
  SWITCH_LABEL.test(normalize(src.label)) && LIGHT_LABEL.test(normalize(dst.label)) && LIGHT_ACTION.test(relation);
const controlsWater = (src, dst, relation) =>
  normalize(src.label) === 'faucet' && normalize(dst.label) === 'sink' && relation === 'control the water flow';

function openCloseIntent(phrase) {
  let [, action, target] = phrase.match(/^(open|close) (?:the |a )?([a-z]+(?: [a-z]+)?)$/) ?? [];
  const korean = phrase.match(/^(서랍|문|오븐|병)(?:을|를)? ?(열어|닫아) ?줘$/);
  if (korean) {
    target = {서랍: 'drawer', 문: 'door', 오븐: 'oven', 병: 'bottle'}[korean[1]];
    action = korean[2] === '열어' ? 'open' : 'close';
  }
  if (!action || target.startsWith('or ')) return;
  return (_src, dst, relation) => {
    const verbs = relation.match(/^(?:(?:pull|push|slide|turn|rotate) to )?(open|close)(?: or (open|close))?\b/);
    return normalize(dst.label) === target && !!verbs && verbs.slice(1).includes(action);
  };
}

function findMatches(phrase, nodes, edges, matchIntent) {
  if (!phrase) return [];
  const byId = new Map(nodes.map(n => [n.id, n]));
  const matches = new Map();
  for (const e of edges) {
    const src = byId.get(e.src), dst = byId.get(e.dst);
    if (e.status !== 'committed' || !src || !dst) continue;
    const relation = normalize(e.text);
    const match = matchIntent
      ? matchIntent(src, dst, relation)
      : ` ${relation} `.includes(` ${phrase} `);
    if (!match) continue;
    if (!matches.has(src.id)) matches.set(src.id, {node: src, edges: []});
    matches.get(src.id).edges.push(e);
  }
  if (!matchIntent) {
    for (const n of nodes) {
      if ((normalize(n.label) === phrase || normalize(n.id) === phrase) && !matches.has(n.id)) {
        matches.set(n.id, {node: n, edges: []});
      }
    }
  }
  return [...matches.values()];
}

export function queryGraph(query, nodes, edges) {
  const phrase = normalize(query);
  return findMatches(phrase, nodes, edges, LIGHT_INTENT.test(phrase) ? controlsLight : undefined);
}

export function resolveGraphQuery(value, visibleNodes, visibleEdges) {
  const phrase = normalize(value);
  if (/\b(?:not|don t|never)\b|지 ?마|안 ?(?:열|닫|켜|틀)/.test(phrase)) {
    return {matches: [], candidateOnly: false};
  }
  if (LIGHT_INTENT.test(phrase) || KOREAN_LIGHT_INTENT.test(phrase)) {
    const matches = findMatches(phrase, visibleNodes, visibleEdges, controlsLight);
    if (matches.length) return {matches, candidateOnly: false};

    const candidates = visibleNodes.filter(node => SWITCH_LABEL.test(normalize(node.label)));
    return {matches: candidates.map(node => ({node, edges: []})), candidateOnly: candidates.length > 0};
  }

  const matchIntent = WATER_INTENT.test(phrase) ? controlsWater : openCloseIntent(phrase);
  return {matches: findMatches(phrase, visibleNodes, visibleEdges, matchIntent), candidateOnly: false};
}

export function resolveLunaGraphQuery(result, graphNodes, committedEdges) {
  const byId = new Map(graphNodes.map(node => [node.id, node]));
  const matches = new Map();
  const addNode = id => {
    const node = byId.get(id);
    if (node && !matches.has(id)) matches.set(id, {node, edges: []});
    return matches.get(id);
  };
  if (!result || !Array.isArray(result.node_ids) || !Array.isArray(result.edge_indices)) {
    return {matches: [], candidateOnly: false};
  }

  for (const id of result.node_ids) if (typeof id === 'string') addNode(id);
  for (const index of result.edge_indices) {
    if (!Number.isInteger(index) || index < 0) continue;
    const edge = committedEdges[index];
    if (!edge || edge.status !== 'committed' || !byId.has(edge.src) || !byId.has(edge.dst)) continue;
    const source = addNode(edge.src);
    if (source && !source.edges.includes(edge)) source.edges.push(edge);
  }
  const edgeCount = [...matches.values()].reduce((count, match) => count + match.edges.length, 0);
  return {
    matches: [...matches.values()],
    candidateOnly: result.candidate_only === true && edgeCount === 0 && matches.size > 0,
  };
}

export function graphQueryExample(nodes, edges) {
  if (queryGraph(EXAMPLE_RELATION, nodes, edges).length) return EXAMPLE_RELATION;
  const byId = new Map(nodes.map(n => [n.id, n]));
  const committed = edges.filter(e => e.status === 'committed' && byId.has(e.src) && byId.has(e.dst));
  const evidence = committed.find(e => byId.get(e.src).role === 'U' && normalize(e.text) && !LIGHT_INTENT.test(normalize(e.text)))
    ?? committed.find(e => normalize(e.text) && !LIGHT_INTENT.test(normalize(e.text)));
  const node = byId.get(committed[0]?.src) ?? nodes.find(n => n.role === 'U') ?? nodes[0];
  return evidence?.text.trim() || node?.label || node?.id;
}
