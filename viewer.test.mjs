import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {graphQueryExample, queryGraph, resolveGraphQuery, resolveLunaGraphQuery} from './dist/js/graph-query.js';

const lightQueries = ['turn on the light', '불 켜줘'];
const waterQueries = ['turn on the water', '물 틀어줘'];

const switchNode = {id: 'fixture-switch', role: 'C', label: 'switch'};
const microwave = {id: 'fixture-microwave', role: 'O', label: 'microwave'};
const handle = {id: 'fixture-handle', role: 'U', label: 'handle'};
const microwaveEdge = {
  src: handle.id, dst: microwave.id, kind: 'local', status: 'committed',
  text: 'open or close the microwave', commit_kf: 3,
};
const fixtureNodes = [switchNode, microwave, handle];
const fixtureEdges = [microwaveEdge];

test('an unlinked switch is searchable without claiming it controls a light', () => {
  assert.deepEqual(queryGraph('turn on the light', fixtureNodes, fixtureEdges), []);
  assert.deepEqual(queryGraph('switch', fixtureNodes, fixtureEdges), [{node: switchNode, edges: []}]);
});

test('the microwave example returns the recorded handle and committed edge', () => {
  const example = graphQueryExample(fixtureNodes, fixtureEdges);
  assert.equal(example, microwaveEdge.text);
  const [{node, edges}, ...otherMatches] = queryGraph(example, fixtureNodes, fixtureEdges);
  assert.deepEqual(otherMatches, []);
  assert.strictEqual(node, handle);
  assert.equal(edges.length, 1);
  assert.strictEqual(edges[0], microwaveEdge);
  assert.deepEqual(queryGraph(example, fixtureNodes, fixtureEdges.filter(e => e.commit_kf <= 2)), []);
});

test('the example falls back to an actual relation or node in other graphs', () => {
  const knob = {id: 'U1', role: 'U', label: 'dial'};
  const nodes = [knob, {id: 'O1', role: 'O', label: 'oven'}];
  const edge = {src: knob.id, dst: 'O1', status: 'committed', text: 'adjust heat'};
  assert.equal(graphQueryExample(nodes, [edge]), edge.text);
  assert.deepEqual(queryGraph(graphQueryExample(nodes, [edge]), nodes, [edge]), [{node: knob, edges: [edge]}]);
  assert.equal(graphQueryExample(nodes, [{...edge, status: 'tentative'}]), knob.label);
  assert.equal(graphQueryExample([], []), undefined);
});

test('the light intent requires explicit committed evidence to a recorded light', () => {
  const switchNode = {id: 'S1', label: 'wall switch'};
  const otherSwitch = {id: 'S2', label: 'switch'};
  const nodes = [switchNode, otherSwitch, {id: 'L1', label: 'ceiling light'}, {id: 'F1', label: 'fan'}];
  const edge = {src: 'S1', dst: 'L1', kind: 'remote', status: 'committed', text: 'turns the light on or off'};
  const unsupported = [
    {...edge, status: 'tentative'},
    {...edge, text: 'does not turn on the light'},
    {...edge, text: 'near the light'},
    {...edge, dst: 'F1', text: 'controls'},
    {...edge, dst: 'missing'},
  ];
  for (const query of [...lightQueries, 'Turn on the light!']) {
    assert.deepEqual(queryGraph(query, nodes, unsupported), []);
    assert.deepEqual(resolveGraphQuery(query, nodes, unsupported), {
      matches: [{node: switchNode, edges: []}, {node: otherSwitch, edges: []}],
      candidateOnly: true,
    });
    const matches = [{node: switchNode, edges: [edge]}];
    assert.deepEqual(resolveGraphQuery(query, nodes, [...unsupported, edge]), {matches, candidateOnly: false});
    assert.deepEqual(resolveGraphQuery(query, [otherSwitch, nodes[2]], [edge]), {
      matches: [{node: otherSwitch, edges: []}],
      candidateOnly: true,
    });
    assert.deepEqual(resolveGraphQuery(query, [switchNode], [edge]), {
      matches: [{node: switchNode, edges: []}],
      candidateOnly: true,
    });
    assert.deepEqual(resolveGraphQuery(query, [nodes[2]], [edge]), {matches: [], candidateOnly: false});
  }
  assert.deepEqual(queryGraph('Turn on the light!', nodes, [...unsupported, edge]), [
    {node: switchNode, edges: [edge]},
  ]);
});

test('the resolver preserves exact label, ID and relation searches', () => {
  for (const [query, matches] of [
    ['switch', [{node: switchNode, edges: []}]],
    [handle.id, [{node: handle, edges: []}]],
    [microwaveEdge.text, [{node: handle, edges: [microwaveEdge]}]],
    ['', []],
    ['unknown query', []],
  ]) {
    assert.deepEqual(resolveGraphQuery(query, fixtureNodes, fixtureEdges), {matches, candidateOnly: false});
  }
});

test('Luna results resolve only to loaded nodes and committed graph edges', () => {
  const result = resolveLunaGraphQuery({
    node_ids: ['fixture-microwave', 'made-up-node'],
    edge_indices: [0, 1, 999, true],
    candidate_only: true,
  }, fixtureNodes, [microwaveEdge, {...microwaveEdge, status: 'tentative'}]);
  assert.deepEqual(result, {
    matches: [
      {node: microwave, edges: []},
      {node: handle, edges: [microwaveEdge]},
    ],
    candidateOnly: false,
  });

  assert.deepEqual(resolveLunaGraphQuery({
    node_ids: [switchNode.id], edge_indices: [], candidate_only: true,
  }, fixtureNodes, fixtureEdges), {
    matches: [{node: switchNode, edges: []}],
    candidateOnly: true,
  });
  assert.deepEqual(resolveLunaGraphQuery({
    node_ids: ['not-in-graph'], edge_indices: [42], candidate_only: true,
  }, fixtureNodes, fixtureEdges), {matches: [], candidateOnly: false});
});

test('the shipped graph supplies light candidates and committed water control evidence', () => {
  const {nodes, edges} = JSON.parse(readFileSync(new URL('./dist/data/graph.json', import.meta.url), 'utf8'));
  const switches = nodes.filter(node => node.label === 'switch');
  assert.ok(switches.length, 'the shipped graph should include switches');
  for (const query of lightQueries) {
    assert.deepEqual(queryGraph(query, nodes, edges), []);
    assert.deepEqual(resolveGraphQuery(query, nodes, edges), {
      matches: switches.map(node => ({node, edges: []})),
      candidateOnly: true,
    });
  }

  const faucet = nodes.find(node => node.label === 'faucet');
  const sink = nodes.find(node => node.label === 'sink');
  assert.ok(faucet && sink);
  const waterEdge = edges.find(edge => edge.src === faucet.id && edge.dst === sink.id
    && edge.status === 'committed' && edge.text === 'control the water flow');
  assert.ok(waterEdge, 'the shipped graph should record faucet-to-sink water control');
  for (const query of [...waterQueries, waterEdge.text]) {
    const result = resolveGraphQuery(query, nodes, edges);
    assert.deepEqual(result, {matches: [{node: faucet, edges: [waterEdge]}], candidateOnly: false});
    assert.strictEqual(result.matches[0].node, faucet);
    assert.strictEqual(result.matches[0].edges[0], waterEdge);
  }
  for (const query of waterQueries) {
    for (const [visibleNodes, visibleEdges] of [
      [[faucet], [waterEdge]],
      [[sink], [waterEdge]],
      [[faucet, sink], []],
      [[faucet, sink], [{...waterEdge, status: 'tentative'}]],
      [[faucet, sink], [{...waterEdge, text: 'near the sink'}]],
      [[faucet, sink], [{...waterEdge, src: sink.id, dst: faucet.id}]],
    ]) {
      assert.deepEqual(resolveGraphQuery(query, visibleNodes, visibleEdges), {matches: [], candidateOnly: false});
    }
  }
});

test('opening and closing drawer or door require an action on the requested destination', () => {
  const {nodes, edges} = JSON.parse(readFileSync(new URL('./dist/data/graph.json', import.meta.url), 'utf8'));
  const byId = new Map(nodes.map(node => [node.id, node]));
  for (const [target, queries] of [
    ['drawer', ['open the drawer', 'open drawer', '서랍 열어줘', 'close the drawer', '서랍을 닫아 줘']],
    ['door', ['open the door', '문 열어줘', 'close the door']],
  ]) {
    const expected = edges.filter(edge => edge.status === 'committed'
      && byId.get(edge.src)?.label === 'handle' && byId.get(edge.dst)?.label === target
      && edge.text === 'pull to open or close');
    assert.ok(expected.length, `the shipped graph should record handle actions for the ${target}`);
    for (const query of queries) {
      const {matches, candidateOnly} = resolveGraphQuery(query, nodes, edges);
      assert.equal(candidateOnly, false);
      const evidence = matches.flatMap(({node, edges: relations}) => {
        assert.ok(relations.length);
        for (const edge of relations) assert.strictEqual(node, byId.get(edge.src));
        return relations;
      });
      assert.equal(evidence.length, expected.length);
      assert.deepEqual(new Set(evidence), new Set(expected));
    }
  }
});

test('action queries reject missing evidence, unknown requests and negation', () => {
  const drawer = {id: 'fixture-drawer', label: 'drawer'};
  const door = {id: 'fixture-door', label: 'door'};
  const nodes = [handle, drawer, door];
  const edge = {src: handle.id, dst: drawer.id, status: 'committed', text: 'pull to open or close'};
  const noMatch = {matches: [], candidateOnly: false};
  assert.deepEqual(resolveGraphQuery('open the drawer', nodes, [
    {...edge, status: 'tentative'},
    {...edge, dst: door.id, text: 'open the drawer'},
    {...edge, text: 'push to close'},
    {...edge, text: 'near the open drawer'},
    {...edge, text: 'do not open the drawer'},
  ]), noMatch);
  assert.deepEqual(resolveGraphQuery('open the drawer', [handle, door], [edge]), noMatch);
  for (const query of [
    "don't open the drawer", 'do not open the drawer', '서랍 열지 마', '서랍 안 열어줘',
    'open the cabinet', 'paint the drawer',
  ]) {
    assert.deepEqual(resolveGraphQuery(query, nodes, [edge]), noMatch);
  }
  assert.deepEqual(resolveGraphQuery('do not open the drawer', nodes, [
    {...edge, text: 'do not open the drawer'},
  ]), noMatch);
});

test('queries on the shipped graph return evidence from the loaded export', () => {
  const {nodes, edges} = JSON.parse(readFileSync(new URL('./dist/data/graph.json', import.meta.url), 'utf8'));
  const byId = new Map(nodes.map(node => [node.id, node]));
  const recordedEdges = new Set(edges);
  const words = text => (text?.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(' ');
  const example = graphQueryExample(nodes, edges);
  const lightQuery = 'turn on the light';

  if (nodes.length) {
    assert.ok(example, 'a nonempty graph should provide a searchable example');
    assert.ok(queryGraph(example, nodes, edges).length, 'the example should match the loaded graph');
  }
  for (const query of new Set([lightQuery, example].filter(Boolean))) {
    for (const {node, edges: evidence} of queryGraph(query, nodes, edges)) {
      assert.strictEqual(node, byId.get(node.id));
      if (query === lightQuery) {
        assert.ok(evidence.length, 'a light intent match needs a committed edge');
      } else if (!evidence.length) {
        assert.ok([words(node.label), words(node.id)].includes(words(query)));
      }
      for (const edge of evidence) {
        assert.ok(recordedEdges.has(edge), 'evidence should be an edge from the loaded export');
        assert.equal(edge.status, 'committed');
        assert.equal(edge.src, node.id);
        assert.ok(byId.has(edge.dst), 'the relation target should exist in the loaded export');
        if (query !== lightQuery) assert.ok(` ${words(edge.text)} `.includes(` ${words(query)} `));
      }
    }
  }
});
