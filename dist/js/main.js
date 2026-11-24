import {mountAnchorDemo} from './anchor.js';
import {mountPosteriorDemo} from './posterior-ui.js';
import {renderResults} from './project-page.js?v=4';

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const fmt = new Intl.NumberFormat('ko-KR');
const ROLE_NAME = {O: '물체', C: '중간 부품', U: '조작 부위'};
const ROLE_CSS = {O: '#d88c33', C: '#5a8ad6', U: '#2fc49c'};
const viewerOnly = new URLSearchParams(location.search).get('view') === '3d';
const runLinks = [...$('run-selector').querySelectorAll('[data-run]')];
const viewerBox = $('viewer');
const runSection = $('run');
const lunaRun = getJSON('data/run.json');
const datasets = new Map();
const visibleRoles = new Set(['O', 'C', 'U']);
let requested, displayed, surface;

if (!viewerOnly) {
  mountAnchorDemo();
  mountPosteriorDemo();
  lunaRun.then(renderResults).catch(() => { $('results-context').textContent = '재현 실행 기록을 불러오지 못했습니다.'; });
}

function readSelection(url) {
  const frame = url.searchParams.get('frame');
  return {
    run: url.searchParams.get('run') === 'deepseek' ? 'deepseek' : 'luna',
    frame: /^\d+$/.test(frame ?? '') ? Number(frame) : null,
  };
}

document.addEventListener('click', event => {
  const link = event.target.closest('a[data-run]');
  if (!link || event.defaultPrevented || event.button !== 0 ||
      event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  const url = new URL(link.href);
  if (url.href !== location.href) history.pushState(null, '', url);
  const selection = readSelection(url);
  const section = url.hash === '#inference' ? 'inference' : 'run';
  const ready = showRun(selection, {keepTime: selection.frame === null});
  if (!runSection.contains(document.activeElement)) runLinks.find(item => item.dataset.run === selection.run).focus({preventScroll: true});
  if (section === 'inference') ready.then(() => {
    if (url.href !== location.href) return;
    const target = $('inference').hidden ? $('run') : $('inference');
    target.scrollIntoView();
    if (target.id === 'inference') $('inf-frame').focus({preventScroll: true});
  });
});

window.addEventListener('popstate', () => showRun(readSelection(new URL(location.href))));
const initialURL = new URL(location.href);
showRun(readSelection(initialURL)).then(() => {
  if (initialURL.href === location.href && initialURL.hash === '#inference' && !$('inference').hidden) {
    $('inference').scrollIntoView();
  }
});

async function getJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(path + ' (' + res.status + ')');
  return res.json();
}

async function loadCloud(path, meta) {
  const res = await fetch(path + meta.file);
  if (!res.ok) throw new Error('점군 파일 (' + res.status + ')');
  const buf = await res.arrayBuffer(), n = meta.count;
  if (buf.byteLength !== n * 9) throw new Error('점군 파일 크기가 기록과 다릅니다.');
  const q = new Int16Array(buf, 0, n * 3), positions = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) {
    const a = i % 3; positions[i] = meta.min[a] + (q[i] + 32768) / 65535 * (meta.max[a] - meta.min[a]);
  }
  return {positions, colors: new Uint8Array(buf, n * 6, n * 3)};
}

function showRun(selection, {keepTime = false} = {}) {
  const status = $('run-load-status');
  const existing = [requested, displayed].find(item => item?.run === selection.run);
  if (existing) {
    requested = existing;
    if (existing.requestedFrame !== selection.frame) {
      existing.requestedFrame = selection.frame;
      existing.selectFrame?.(selection.frame);
    }
    if (existing === displayed) {
      status.textContent = '';
      runSection.removeAttribute('aria-busy');
    }
    return existing.ready;
  }

  const current = {run: selection.run, requestedFrame: selection.frame};
  requested = current;
  if (displayed) {
    const name = runLinks.find(link => link.dataset.run === current.run).textContent;
    status.textContent = name + ' 지도를 준비하는 중입니다.';
  }
  runSection.setAttribute('aria-busy', 'true');
  current.ready = getRunData(current.run).then(data => {
    if (requested !== current) return;
    current.currentFrame = keepTime ? displayed?.currentFrame ?? null : null;
    surface ??= data.createViewer(viewerBox);
    displayed?.controller.abort();
    current.controller = new AbortController();
    showMap(current, data);
    displayed = current;
    status.textContent = '';
    if (!viewerOnly) {
      getRunData(current.run === 'luna' ? 'deepseek' : 'luna').catch(() => {});
    }
  }).catch(error => {
    if (requested !== current) return;
    requested = displayed;
    if (displayed) {
      status.textContent = '선택한 지도를 불러오지 못했습니다. 다시 선택해 주세요.';
    } else {
      status.textContent = '3D 지도를 불러오지 못했습니다.';
      viewerBox.querySelector('.viewer-wait')?.remove();
      $('run-lede').textContent = '실행 결과를 불러오지 못했습니다. ' + error.message;
      runLinks.find(link => link.dataset.run === current.run).hidden = false;
    }
  }).finally(() => {
    if (requested === current || !requested || requested === displayed) {
      runSection.removeAttribute('aria-busy');
    }
  });
  return current.ready;
}

function getRunData(key) {
  if (!datasets.has(key)) {
    datasets.set(key, loadRunData(key).catch(error => {
      datasets.delete(key);
      throw error;
    }));
  }
  return datasets.get(key);
}

async function loadRunData(key) {
  const isDeepSeek = key === 'deepseek';
  const path = isDeepSeek ? 'data/deepseek/' : 'data/';
  const run = await (isDeepSeek ? getJSON(path + 'run.json') : lunaRun);
  const observation = url => url?.startsWith('data/observations/') ? path + url.slice('data/'.length) : url;
  const frames = (run.frames ?? []).map(frame => ({
    ...frame,
    url: observation(frame.url),
    segmentation_url: observation(frame.segmentation_url),
  }));
  const [graph, cloud, {createViewer}, perception] = await Promise.all([
    run.graph ? getJSON(path + run.graph) : null,
    loadCloud(path, run.map),
    import('./viewer.js?v=3'),
    run.inference && !viewerOnly
      ? Promise.all([import('./inference.js?v=2'), getJSON(path + run.inference)]) : null,
  ]);
  return {run, frames, graph, cloud, createViewer, perception, isDeepSeek};
}

function showMap(current, {run, frames, graph, cloud, perception, isDeepSeek}) {
  const {signal} = current.controller;
  for (const link of runLinks) {
    if (link.dataset.run === current.run) {
      link.hidden = false;
      link.setAttribute('aria-current', 'true');
    } else link.removeAttribute('aria-current');
  }
  for (const id of ['role-filter', 'graph-query', 'tree', 'tree-count', 'detail', 'run-metrics', 'run-meta-body']) $(id).replaceChildren();
  for (const id of ['inference', 'timeline', 'loop-run']) $(id).hidden = true;
  $('graph-query').classList.remove('graph-query');

  describeRun(run, graph);
  if (run.loops && graph) describeLoops(run.loops);
  if (perception) {
    const [{mountInference}, inference] = perception;
    mountInference(inference, frames, {hasGraph: !!graph, signal});
  }

  const viewer = surface.showMap({cloud, trajectory: run.trajectory, graph, loops: run.loops, isDeepSeek, signal});
  const requestedFrame = frames[current.requestedFrame] ? current.requestedFrame : null;
  wireViewer(viewer, frames, graph, requestedFrame, signal, time => {
    current.currentFrame = time === Infinity ? null : run.trajectory.find(k => k.kf === time)?.frame ?? null;
  });
  const setTimeForFrame = frame => {
    const keyframe = frame === null ? undefined : run.trajectory.findLast(k => k.frame <= frame);
    viewer.setTime(frame === null || frame === frames.length - 1 ? Infinity : keyframe?.kf ?? 0);
    current.currentFrame = frame;
  };
  current.selectFrame = frame => {
    const index = frames[frame] ? frame : null;
    setTimeForFrame(index);
    if (index !== null && perception?.[1].frames[index]) {
      $('inf-frame').value = index;
      $('inf-frame').dispatchEvent(new Event('input'));
    }
  };
  current.selectFrame(requestedFrame ?? current.currentFrame);
  $('run-meta').hidden = false;
}

function describeLoops(loops) {
  const box = $('loop-run');
  const searched = loops.events.length, withFn = loops.events.filter(e => e.proposed.length).length;
  box.hidden = false;
  box.textContent = `루프 검색 ${searched}회에서 영상 후보 ${loops.visual_candidates}개가 나왔습니다. 기능 그래프는 ${withFn}회에 걸쳐 후보 ${loops.functional_proposed}개를 보탰고, 그중 ${loops.functional_accepted}개가 기하 검증을 통과했습니다.`
    + (loops.functional_accepted ? ' 통과한 연결은 3D 지도에 분홍 점선으로 표시합니다.' : '');
}

function describeRun(run, graph) {
  $('graph-explainer').hidden = !graph;
  const lede = $('run-lede');
  const llm = run.llm?.model ? ' · ' + run.llm.model : '';
  lede.textContent = graph
    ? `FunGraph3D 0kitchen/video0 · RGB ${run.frames_processed}장${llm}`
    : run.inference
      ? '이 실행은 점군, 카메라 경로와 2D 추론 기록을 제공합니다.' + llm
      : '이 실행은 점군과 카메라 경로를 제공합니다.' + llm;
  const m = $('run-metrics');
  const add = (value, label, cls = '') => { const d = el('div', cls); d.append(el('b', null, value), el('span', null, label)); m.append(d); };
  if (graph) {
    for (const r of ['O', 'C', 'U']) add(fmt.format(graph.nodes.filter(n => n.role === r).length), ROLE_NAME[r] + ' 노드 (' + r + ')', r.toLowerCase());
    add(fmt.format(graph.edges.filter(e => e.kind === 'local').length), '로컬 연결');
    add(fmt.format(graph.edges.filter(e => e.kind === 'remote').length), '원격 연결');
  }
  add(fmt.format(run.keyframes), '키프레임');
  if (run.loops) add(run.loops.functional_accepted + ' / ' + run.loops.functional_proposed, '기능 루프 후보 검증 통과');
  const meta = $('run-meta-body'), dl = el('dl');
  for (const [k, v] of run.meta) { dl.append(el('dt', null, k), el('dd', null, v)); }
  const pre = el('pre'); pre.append(el('code', null, run.command));
  meta.append(dl, pre);
}

function wireViewer(viewer, frames, graph, frameIndex, signal, rememberTime) {
  const roles = visibleRoles;
  const chipBox = $('role-filter');
  for (const r of ['O', 'C', 'U']) {
    const b = el('button'); b.type = 'button'; b.setAttribute('aria-pressed', String(roles.has(r)));
    const dot = el('i'); dot.style.background = ROLE_CSS[r]; b.append(dot, document.createTextNode(r + ' ' + ROLE_NAME[r]));
    b.addEventListener('click', () => { roles.has(r) ? roles.delete(r) : roles.add(r); b.setAttribute('aria-pressed', String(roles.has(r))); viewer.setRoles(new Set(roles)); });
    chipBox.append(b);
  }
  chipBox.hidden = !graph;
  viewer.setRoles(new Set(roles));
  $('show-cloud').addEventListener('change', e => viewer.setCloud(e.target.checked), {signal});
  $('show-traj').addEventListener('change', e => viewer.setTrajectory(e.target.checked), {signal});
  $('point-size').addEventListener('input', e => viewer.setPointSize(Number(e.target.value)), {signal});
  viewer.setCloud($('show-cloud').checked);
  viewer.setTrajectory($('show-traj').checked);
  viewer.setPointSize(Number($('point-size').value));
  $('view-reset').addEventListener('click', () => viewer.reset(), {signal});
  if (!graph) {
    if (frameIndex !== null) showFrame();
    else $('detail').append(el('p', 'empty', '기능 그래프가 생성되면 노드를 눌러 실제 관측 사진과 연결 근거를 볼 수 있습니다.'));
    return;
  }

  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const parentOf = new Map(), children = new Map();
  for (const e of graph.edges) if (e.kind === 'local') { parentOf.set(e.src, e); if (!children.has(e.dst)) children.set(e.dst, []); children.get(e.dst).push(e.src); }
  const buttons = new Map();
  const listed = new Set();
  function item(id) {
    listed.add(id);
    const n = byId.get(id), li = el('li'), b = el('button');
    b.type = 'button'; b.append(el('i', n.role), document.createTextNode(n.label), el('small', null, n.role));
    b.addEventListener('click', () => selectFinal(id));
    buttons.set(id, b); li.append(b);
    const kids = (children.get(id) ?? []).filter(k => !listed.has(k)).slice().sort((a, b) => byId.get(a).role.localeCompare(byId.get(b).role));
    if (kids.length) { const ul = el('ul'); kids.forEach(k => ul.append(item(k))); li.append(ul); }
    return li;
  }
  const tree = $('tree'), roots = graph.nodes.filter(n => !parentOf.has(n.id) && (children.has(n.id) || n.role === 'O'));
  const size = (id, seen = new Set()) => { if (seen.has(id)) return 0; seen.add(id); return 1 + (children.get(id) ?? []).reduce((s, k) => s + size(k, seen), 0); };
  roots.sort((a, b) => size(b.id) - size(a.id));
  const ul = el('ul'); roots.forEach(n => ul.append(item(n.id))); tree.append(ul);
  const orphans = graph.nodes.filter(n => !listed.has(n.id));
  if (orphans.length) { tree.append(el('p', 'group', '그 밖의 노드')); const u2 = el('ul'); orphans.forEach(n => u2.append(item(n.id))); tree.append(u2); }
  $('tree-count').textContent = '노드 ' + graph.nodes.length + ' · 연결 ' + graph.edges.length;

  let current = null;
  function select(id, fly = true, scroll = true, observationIndex = null) {
    const n = byId.get(id); if (!n) return;
    if (!roles.has(n.role)) { roles.add(n.role); viewer.setRoles(new Set(roles)); chipBox.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String(roles.has(['O', 'C', 'U'][i])))); }
    current = id; viewer.select(id, fly);
    buttons.forEach((b, k) => b.classList.toggle('on', k === id));
    if (scroll) buttons.get(id)?.scrollIntoView({block: 'nearest'});
    showDetail(id, observationIndex);
  }
  function selectFinal(id) {
    viewer.setTime(Infinity);
    select(id);
  }
  viewer.onSelect((id, time) => {
    if (id == null) {
      buttons.get(current)?.classList.remove('on');
      current = null;
      $('detail').replaceChildren(el('p', 'empty', '지도에서 노드를 누르면 관측 프레임과 연결 근거를 볼 수 있습니다.'));
      return;
    }
    current = id;
    if (time === Infinity) select(id, false, false);
  });
  let showingFinal = true;
  viewer.onTimeChange(time => {
    rememberTime(time);
    const final = time === Infinity;
    if (final === showingFinal) return;
    showingFinal = final;
    if (final && current) select(current, false, false);
    if (!final) {
      $('detail').replaceChildren(el('p', 'empty', '이 시점의 노드와 연결을 누르면 3D 그래프 위에 선택 정보가 표시됩니다.'));
      buttons.get(current)?.classList.remove('on');
    }
  });

  function crop(f, n, matched = false) {
    const div = el('div', 'crop'), img = el('img');
    img.src = f.url; img.alt = n ? n.label + ' · ' + f.name : f.name;
    img.addEventListener('error', () => { div.replaceChildren(el('p', 'empty', '관측 사진을 불러오지 못했습니다.')); });
    div.append(img);
    if (matched && Array.isArray(n.box) && n.box.length === 4 && n.box.every(Number.isFinite)) {
      const [x0, y0, x1, y1] = n.box;
      if (x0 >= 0 && y0 >= 0 && x1 <= 1 && y1 <= 1 && x1 > x0 && y1 > y0) {
        const bx = el('div', 'box');
        Object.assign(bx.style, {left: x0 * 100 + '%', top: y0 * 100 + '%', width: (x1 - x0) * 100 + '%', height: (y1 - y0) * 100 + '%', borderColor: ROLE_CSS[n.role]});
        div.append(bx);
      }
    }
    const caption = n
      ? (matched ? '마지막 관측 프레임 ' : '대표 프레임 · 박스 대응 정보 없음 · ') + f.name + ' · 박스는 2D 관측 영역이며 3D 형상이 아닙니다.'
      : f.name;
    const wrap = el('div'); wrap.append(div, el('p', 'crop-cap', caption));
    const source = el('a', 'crop-cap', '원본 사진 보기'); source.href = f.url; source.target = '_blank'; source.rel = 'noopener'; wrap.append(source);
    return wrap;
  }
  function showFrame() {
    $('detail').append(el('p', 'empty', '이 프레임과 연결된 3D 노드 관측 기록이 없습니다.'), crop(frames[frameIndex]));
  }
  function link(id) { const b = el('button', null, byId.get(id).label); b.type = 'button'; b.addEventListener('click', () => select(id)); return b; }
  function showDetail(id, observationIndex) {
    const n = byId.get(id), box = $('detail'); box.replaceChildren();
    const h = el('h4'); h.append(el('span', 'role ' + n.role, n.role), document.createTextNode(n.label)); box.append(h);
    const dl = el('dl');
    const add = (k, v) => { if (v != null && v !== '') dl.append(el('dt', null, k), el('dd', null, v)); };
    add('역할', ROLE_NAME[n.role]); add('노드 ID', n.id); add('관측 횟수', n.obs != null ? n.obs + '회' : null);
    add('앵커 키프레임', n.anchor_kf != null ? '#' + n.anchor_kf : null);
    add('처음 등장', n.born_kf != null ? '키프레임 #' + n.born_kf : null);
    box.append(dl);
    const matched = Number.isInteger(n.box_frame) && !!frames[n.box_frame];
    const index = observationIndex ?? (matched ? n.box_frame : n.best_frame);
    if (frames[index]) box.append(crop(frames[index], n, matched && index === n.box_frame));
    const rel = el('div', 'rel');
    const chain = []; let cur = id;
    while (parentOf.has(cur) && chain.length < 6) { const e = parentOf.get(cur); chain.push(e); cur = e.dst; }
    if (chain.length) {
      const p = el('p'); p.append(el('b', null, '로컬 경로 (부위 → 상위 대상) '));
      chain.forEach((e, i) => { if (i) p.append(' → '); p.append(link(e.dst)); });
      rel.append(p);
      const e = chain[0];
      rel.append(el('p', null, '“' + (e.text || e.type) + '” · ' + (e.status === 'committed' ? '확정' : e.status) + (e.support != null ? ' · 지지 횟수 ' + e.support + '회' : '') + (e.margin != null ? ' · 누적 점수 차 ' + e.margin.toFixed(2) : '') + (e.commit_kf != null ? ' · 키프레임 #' + e.commit_kf + '에서 확정' : '')));
    }
    const kids = children.get(id) ?? [];
    if (kids.length) { const p = el('p'); p.append(el('b', null, '들어오는 로컬 연결 ')); kids.forEach((k, i) => { if (i) p.append(', '); p.append(link(k)); }); rel.append(p); }
    for (const e of graph.edges.filter(e => e.kind === 'remote' && (e.src === id || e.dst === id))) {
      const p = el('p'); p.append(el('b', null, '원격 '), link(e.src), ' → ', link(e.dst), ' “' + (e.text || e.type) + '”'); rel.append(p);
    }
    if (!chain.length && !kids.length) rel.append(el('p', null, n.role === 'O' ? '이 물체에 확정된 부품 연결은 없습니다.' : '이 부위의 소속은 아직 확정되지 않았습니다.'));
    box.append(rel);
  }
  function selectEdge(e, fly = true, scroll = true) {
    const role = byId.get(e.dst).role;
    if (!roles.has(role)) { roles.add(role); viewer.setRoles(new Set(roles)); chipBox.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String(roles.has(['O', 'C', 'U'][i])))); }
    select(e.src, false, scroll); viewer.selectEdge(e, fly);
    const rel = el('div', 'rel edge-detail');
    rel.append(el('b', null, '선택한 ' + (e.kind === 'remote' ? '원격' : '로컬') + ' 연결'));
    const p = el('p'); p.append(link(e.src), ' → ', link(e.dst)); rel.append(p);
    rel.append(el('p', null, '관계 원문: ' + (e.text || e.type || '기록 없음')));
    rel.append(el('p', null, '상태: ' + (e.status || '기록 없음') + (e.support != null ? ' · 지지 횟수 ' + e.support : '') + (e.commit_kf != null ? ' · 확정 키프레임 #' + e.commit_kf : '')));
    rel.append(el('p', null, '로컬 화살표는 부위 → 상위 대상으로 내보낸 탐색 방향입니다. 관계 문구는 원문 그대로여서 화살표와 문장의 방향이 다를 수 있습니다. 원격은 내보낸 src → dst입니다.'));
    $('detail').prepend(rel);
  }
  viewer.onEdgeSelect((e, time) => {
    current = e.src;
    if (time === Infinity) selectEdge(e, false, false);
  });
  if (graph.edges.length) {
    tree.append(el('p', 'group', '확정 연결 · 선택하면 양 끝 노드와 근거 표시'));
    const list = el('ul', 'edge-list');
    for (const e of graph.edges) {
      if (!byId.has(e.src) || !byId.has(e.dst)) continue;
      const li = el('li'), b = el('button', null, byId.get(e.src).label + ' → ' + byId.get(e.dst).label + ' · ' + (e.text || e.type || e.kind));
      b.type = 'button'; b.addEventListener('click', () => { viewer.setTime(Infinity); selectEdge(e); }); li.append(b); list.append(li);
    }
    tree.append(list);
  }
  if (frameIndex !== null) {
    const node = graph.nodes.find(n => n.box_frame === frameIndex) ?? graph.nodes.find(n => n.best_frame === frameIndex);
    if (node) select(node.id, false, false, frameIndex);
    else showFrame();
  } else if (roots.length || graph.nodes.length) select(roots[0]?.id ?? graph.nodes[0].id, false, false);
  else $('detail').append(el('p', 'empty', '이 실행에는 내보낸 3D 노드가 없습니다.'));
}
