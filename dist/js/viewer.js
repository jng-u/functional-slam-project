import * as THREE from '../vendor/three.module.min.js';
import {OrbitControls} from '../vendor/OrbitControls.js';

export const ROLE_COLOR = {O: 0xd88c33, C: 0x5a8ad6, U: 0x2fc49c};
const REMOTE_COLOR = 0xb46fcc;
const MATCH_COLOR = 0x73ffda;
const CANDIDATE_COLOR = 0xffc766;
export {graphQueryExample, queryGraph} from './graph-query.js';
import {LIGHT_QUERY, graphQueryExample, resolveGraphQuery, resolveLunaGraphQuery} from './graph-query.js';

const element = (tag, text) => {
  const el = document.createElement(tag);
  if (text != null) el.textContent = text;
  return el;
};

function button(text, action) {
  const el = element('button', text);
  el.type = 'button';
  el.addEventListener('click', action);
  return el;
}

function graphControls(container, graph, trajectory) {
  const stage = container.parentElement;
  let timeline = stage.querySelector('#timeline');
  if (!timeline) {
    timeline = element('div');
    timeline.className = 'timeline';
    const range = element('input');
    range.type = 'range';
    timeline.append(element('span', '키프레임'), range, element('output'), element('button', '재생'));
    container.after(timeline);
  }
  const slider = timeline.querySelector('input[type="range"]');
  const output = timeline.querySelector('output');
  const play = timeline.querySelector('button');
  slider.setAttribute('aria-label', '그래프 키프레임');
  play.type = 'button';
  timeline.hidden = false;
  const lastKf = Math.max(0, ...trajectory.map((k, i) => k.kf ?? i));
  const end = lastKf + 1;
  const byKeyframe = new Map();
  let lastRow;
  for (const row of graph.timeline ?? []) {
    if (!['kf_idx', 'n_nodes', 'n_stable', 'n_local_edges', 'n_remote_edges'].every(key => Number.isInteger(row?.[key]) && row[key] >= 0)) continue;
    if (!byKeyframe.has(row.kf_idx)) byKeyframe.set(row.kf_idx, row);
    lastRow = row;
  }

  const panel = stage.querySelector('[data-graph-query]') ?? element('div');
  panel.classList.add('graph-query');
  if (!panel.parentElement) container.before(panel);
  const form = element('form');
  form.className = 'viewer-tools graph-query-form';
  form.setAttribute('role', 'search');
  const label = element('label', '기능 쿼리');
  const input = element('input');
  input.type = 'search';
  input.placeholder = '예: 물 틀어줘';
  label.append(input);
  const submit = element('button', '지도에서 강조');
  submit.type = 'submit';
  form.append(label, submit);
  const searchHelp = element('p', '의미 검색은 두 지도에서 공통으로 제공하는 GPT-6 Luna 도구입니다. 현재 선택한 지도의 그래프를 검색하며, 지도 생성에 사용된 언어 모델과는 별개입니다.');
  searchHelp.className = 'viewer-help';
  const status = element('p');
  status.className = 'graph-query-status';
  status.setAttribute('role', 'status');
  const results = element('details');
  results.hidden = true;
  const resultList = element('div');
  resultList.className = 'viewer-tools graph-query-results';
  results.append(element('summary', '일치 항목 보기'), resultList);
  const detail = element('p');
  detail.className = 'viewer-help graph-query-selection';
  detail.setAttribute('aria-live', 'polite');
  detail.hidden = true;
  const serverStatus = element('p', '백엔드 서버 확인 중');
  serverStatus.className = 'graph-query-server-status';
  serverStatus.setAttribute('role', 'status');
  const usage = element('p', '오늘 요청량을 불러오는 중입니다.');
  usage.className = 'graph-query-usage';
  usage.setAttribute('role', 'status');
  panel.append(form, searchHelp, status, serverStatus, usage, results, detail);
  const provenance = element('p');
  provenance.className = 'viewer-help graph-timeline-source';
  timeline.after(provenance);
  return {slider, output, play, end, byKeyframe, lastRow, provenance, form, input, status, serverStatus, usage, results, resultList, detail};
}

function quatToMatrix([x, y, z, w]) {
  return new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion(x, y, z, w));
}

export function createViewer(container) {
  const renderer = new THREE.WebGLRenderer({antialias: true, powerPreference: 'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setClearColor(0x0f1716);
  container.append(renderer.domElement);
  const labels = document.createElement('div'); labels.className = 'labels'; container.append(labels);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.005, 200);
  const surface = {container, renderer, labels, camera, controls: null};
  let draw, raf = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    draw?.(now);
  }
  new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting && !raf) raf = requestAnimationFrame(frame);
    else if (!entry.isIntersecting) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }).observe(container);
  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  return {
    showMap(data) {
      const {render, ...map} = mountMap(surface, data);
      draw = render;
      data.signal.addEventListener('abort', () => { draw = undefined; }, {once: true});
      container.querySelector('.viewer-wait')?.remove();
      return map;
    },
  };
}

function mountMap(surface, {cloud, trajectory, graph, loops, isDeepSeek, signal}) {
  const {container, renderer, labels, camera} = surface;
  const scene = new THREE.Scene();

  // Frame the map with the average camera orientation so "up" matches the video.
  const box = new THREE.Box3(), center = new THREE.Vector3(), up = new THREE.Vector3(), forward = new THREE.Vector3();
  const camPts = trajectory.map(k => new THREE.Vector3(...k.t));
  for (const k of trajectory) {
    const m = quatToMatrix(k.q);
    up.add(new THREE.Vector3(0, -1, 0).applyMatrix4(m));
    forward.add(new THREE.Vector3(0, 0, 1).applyMatrix4(m));
  }
  up.normalize(); forward.normalize();
  if (up.lengthSq() < .1) up.set(0, -1, 0);
  if (forward.lengthSq() < .1) forward.set(0, 0, 1);
  const pos = cloud.positions;
  // Robust extent: 2nd–98th percentile per axis.
  const pct = axis => { const v = []; for (let i = axis; i < pos.length; i += 3 * 7) v.push(pos[i]); v.sort((a, b) => a - b); return [v[Math.floor(v.length * .02)], v[Math.floor(v.length * .98)]]; };
  const ext = [0, 1, 2].map(pct);
  box.min.set(ext[0][0], ext[1][0], ext[2][0]); box.max.set(ext[0][1], ext[1][1], ext[2][1]);
  box.getCenter(center);
  const radius = Math.max(.01, box.getSize(new THREE.Vector3()).length() / 2);
  const firstMap = surface.controls === null;
  if (firstMap) {
    camera.up.copy(up);
    surface.controls = new OrbitControls(camera, renderer.domElement);
    Object.assign(surface.controls, {enableDamping: true, dampingFactor: 0.09, rotateSpeed: 0.75, panSpeed: 0.9, zoomSpeed: 1.1,
      screenSpacePanning: true, zoomToCursor: true});
  }
  const controls = surface.controls;
  controls.minDistance = radius * 0.02;
  controls.maxDistance = radius * 12;

  const home = () => {
    const side = new THREE.Vector3().crossVectors(forward, up).normalize();
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.max(1, 1 / camera.aspect) * 1.08;
    const direction = forward.clone().negate().addScaledVector(up, .55).addScaledVector(side, .2).normalize();
    const eye = center.clone().addScaledVector(direction, distance);
    return {eye, target: center.clone()};
  };

  // Point cloud.
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(cloud.positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(cloud.colors, 3, true));
  const pointMat = new THREE.PointsMaterial({size: radius * 0.006, vertexColors: true, sizeAttenuation: true});
  const points = new THREE.Points(geo, pointMat);
  scene.add(points);

  // Camera path with keyframe dots.
  const traj = new THREE.Group();
  traj.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(camPts), new THREE.LineBasicMaterial({color: 0xf2d16b, transparent: true, opacity: .8})));
  const kfGeo = new THREE.BufferGeometry().setFromPoints(camPts);
  traj.add(new THREE.Points(kfGeo, new THREE.PointsMaterial({color: 0xf2d16b, size: 5, sizeAttenuation: false})));
  // Loop-closure edges that functional topology added and geometry accepted.
  const loopPts = [];
  for (const e of loops?.events ?? []) for (const c of [...e.accepted, ...e.strengthened]) {
    if (camPts[e.kf] && camPts[c]) loopPts.push(camPts[e.kf], camPts[c]);
  }
  if (loopPts.length) {
    const seg = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(loopPts),
      new THREE.LineDashedMaterial({color: 0xff6fb5, dashSize: radius * .03, gapSize: radius * .015, depthTest: false}));
    seg.computeLineDistances(); seg.renderOrder = 7; traj.add(seg);
  }
  scene.add(traj);

  // Functional graph overlay. Drawn on top of the map so small parts stay visible.
  const nodes = graph?.nodes ?? [], edges = graph?.edges ?? [];
  const byId = new Map(nodes.map(n => [n.id, n]));
  const sphere = new THREE.SphereGeometry(1, 18, 12);
  const nodeMat = new THREE.MeshBasicMaterial({depthTest: false, transparent: true, opacity: 0.95});
  const inst = new THREE.InstancedMesh(sphere, nodeMat, Math.max(1, nodes.length));
  inst.renderOrder = 10; inst.count = nodes.length;
  const baseRadius = radius * 0.011;
  const nodeRadius = n => n.role === 'O' ? baseRadius * 1.25 : n.role === 'C' ? baseRadius : baseRadius * 0.78;
  const tmp = new THREE.Object3D(), col = new THREE.Color();
  nodes.forEach((n, i) => inst.setColorAt(i, col.setHex(ROLE_COLOR[n.role] ?? 0xffffff)));
  scene.add(inst);
  const halo = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({color: 0xffffff, transparent: true, opacity: .28, depthTest: false}));
  halo.renderOrder = 9; halo.visible = false; scene.add(halo);

  const edgeGroup = new THREE.Group(); edgeGroup.renderOrder = 8; scene.add(edgeGroup);
  const state = {roles: new Set(['O', 'C', 'U']), time: Infinity, selected: null, hovered: null, edge: null};
  const queryNodes = new Set(), queryEdges = new Set();
  let candidateOnly = false;

  const shownAt = stamp => state.time === Infinity || (Number.isInteger(stamp) && stamp >= 0 && stamp <= state.time);
  const visibleNode = n => n && state.roles.has(n.role) && shownAt(n.born_kf);
  const visibleEdge = e => shownAt(e.commit_kf) && visibleNode(byId.get(e.src)) && visibleNode(byId.get(e.dst));

  function neighborhood(id) {
    const set = new Set([id]);
    let grew = true;
    while (grew) { grew = false; for (const e of edges) if (visibleEdge(e) && e.kind === 'local' && set.has(e.dst) && !set.has(e.src)) { set.add(e.src); grew = true; } }
    for (const e of edges) if (visibleEdge(e) && (e.src === id || e.dst === id)) { set.add(e.src); set.add(e.dst); }
    return set;
  }

  function rebuild() {
    const searching = queryNodes.size > 0;
    const accent = candidateOnly ? CANDIDATE_COLOR : MATCH_COLOR;
    pointMat.color.setHex(searching ? 0x90999a : 0xffffff);
    nodes.forEach((n, i) => {
      const hit = queryNodes.has(n.id);
      const show = visibleNode(n), r = nodeRadius(n) * (hit ? 2 : state.selected === n.id ? 1.5 : 1);
      col.setHex(hit ? accent : ROLE_COLOR[n.role] ?? 0xffffff);
      if (searching && !hit) col.multiplyScalar(.16);
      inst.setColorAt(i, col);
      tmp.position.set(...n.pos); tmp.scale.setScalar(show ? r : 0); tmp.updateMatrix(); inst.setMatrixAt(i, tmp.matrix);
    });
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    edgeGroup.traverse(o => { if (o.parent?.type !== 'ArrowHelper') o.geometry?.dispose(); o.material?.dispose(); });
    edgeGroup.clear();
    const near = state.selected ? neighborhood(state.selected) : null;
    const local = [], localCol = [], hot = [], remote = [], matched = [];
    for (const e of edges) {
      if (!visibleEdge(e)) continue;
      const a = byId.get(e.src), b = byId.get(e.dst);
      const seg = [...a.pos, ...b.pos];
      const queryHit = queryEdges.has(e);
      const direction = new THREE.Vector3(...b.pos).sub(new THREE.Vector3(...a.pos)), length = direction.length();
      if (length > baseRadius * 3) {
        const arrowColor = queryHit ? accent : searching ? 0x475451 : e === state.edge ? 0xffffff : e.kind === 'remote' ? REMOTE_COLOR : ROLE_COLOR[b.role];
        const arrow = new THREE.ArrowHelper(direction.normalize(), new THREE.Vector3(...a.pos), length - nodeRadius(b), arrowColor, Math.min(length * .22, baseRadius * 2.5), baseRadius * 1.3);
        arrow.line.visible = false; arrow.cone.material.depthTest = false; arrow.cone.renderOrder = 9; edgeGroup.add(arrow);
      }
      if (queryHit) matched.push(...seg);
      else if (!searching && (e === state.edge || (near && near.has(e.src) && near.has(e.dst)))) hot.push(...seg);
      else if (e.kind === 'remote') remote.push(...seg);
      else { local.push(...seg); const ca = new THREE.Color(ROLE_COLOR[a.role]), cb = new THREE.Color(ROLE_COLOR[b.role]); localCol.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b); }
    }
    const add = (arr, mat, colors) => {
      if (!arr.length) { mat.dispose(); return; }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      if (colors) g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      const l = new THREE.LineSegments(g, mat); if (mat.isLineDashedMaterial) l.computeLineDistances(); l.renderOrder = 8; edgeGroup.add(l);
    };
    const dim = searching ? .12 : near ? .25 : .85;
    add(local, new THREE.LineBasicMaterial({vertexColors: true, depthTest: false, transparent: true, opacity: dim}), localCol);
    add(remote, new THREE.LineDashedMaterial({color: REMOTE_COLOR, dashSize: radius * .02, gapSize: radius * .012, depthTest: false, transparent: true, opacity: dim}));
    add(hot, new THREE.LineBasicMaterial({color: 0xffffff, depthTest: false}));
    add(matched, new THREE.LineBasicMaterial({color: accent, depthTest: false}));
    const sel = byId.get(state.selected);
    halo.visible = !!sel && visibleNode(sel);
    if (halo.visible) { halo.position.set(...sel.pos); halo.scale.setScalar(nodeRadius(sel) * 3.2); }
    rebuildLabels(near);
  }

  let labelEls = [];
  function rebuildLabels(near) {
    labels.replaceChildren(); labelEls = [];
    const crowd = nodes.filter(visibleNode).length > 40;
    for (const n of nodes) {
      if (!visibleNode(n)) continue;
      const inFocus = near?.has(n.id), always = !crowd || n.role === 'O';
      const hit = queryNodes.has(n.id);
      if (queryNodes.size ? !hit && n.id !== state.hovered && n.id !== state.selected : !(inFocus || always || n.id === state.hovered)) continue;
      const el = button('', () => chooseNode(n.id));
      el.className = 'lbl ' + n.role + (near && !inFocus ? ' dim' : '') + (n.id === state.selected || n.id === state.hovered ? ' hot' : '');
      if (hit) el.classList.add(candidateOnly ? 'query-candidate' : 'query-match');
      el.textContent = n.role + ' · ' + n.label;
      el.title = n.label + ' · ' + n.id;
      labels.append(el); labelEls.push([el, new THREE.Vector3(...n.pos)]);
    }
  }
  const v = new THREE.Vector3();
  function placeLabels(w, h) {
    for (const [el, p] of labelEls) {
      v.copy(p).project(camera);
      const off = v.z < -1 || v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1;
      el.style.display = off ? 'none' : '';
      if (!off) el.style.transform = `translate(${(v.x * .5 + .5) * w}px,${(-v.y * .5 + .5) * h}px) translate(-50%,-160%)`;
    }
  }

  // Smooth camera moves.
  let tween = null;
  function flyTo(eye, target, ms = 650) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { camera.position.copy(eye); controls.target.copy(target); tween = null; return; }
    tween = {t0: performance.now(), ms, e0: camera.position.clone(), g0: controls.target.clone(), e1: eye, g1: target};
  }
  function focus(id) {
    const n = byId.get(id); if (!n) return;
    const target = new THREE.Vector3(...n.pos);
    const dir = camera.position.clone().sub(controls.target).normalize();
    const dist = Math.max(radius * 0.35, Math.min(camera.position.distanceTo(controls.target), radius * 0.9));
    flyTo(target.clone().addScaledVector(dir, dist), target);
  }

  function frameMatches() {
    const bounds = new THREE.Box3();
    for (const id of queryNodes) bounds.expandByPoint(new THREE.Vector3(...byId.get(id).pos));
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
    const halfAngle = Math.min(halfFov, Math.atan(Math.tan(halfFov) * camera.aspect));
    const distance = Math.max(radius * .4, (sphere.radius + 4 * baseRadius) * 1.15 / Math.sin(halfAngle));
    const direction = camera.position.clone().sub(controls.target).normalize();
    flyTo(sphere.center.clone().addScaledVector(direction, distance), sphere.center);
  }

  const cancelTween = () => { tween = null; };
  controls.addEventListener('start', cancelTween);

  // Picking.
  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
  ray.params.Points.threshold = radius * 0.006;
  const listeners = {select: null, edge: null, time: null, hover: () => {}};
  function pick(ev, objects) {
    const r = renderer.domElement.getBoundingClientRect();
    mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    return ray.intersectObjects(objects, false);
  }
  function nodeAt(ev) {
    const hits = pick(ev, [inst]).filter(h => h.instanceId !== undefined && visibleNode(nodes[h.instanceId]));
    return hits.length ? nodes[hits[0].instanceId].id : null;
  }
  // Screen-space tolerance keeps thin edges selectable at every zoom level.
  function edgeAt(ev) {
    const rect = renderer.domElement.getBoundingClientRect();
    const p = new THREE.Vector2(ev.clientX - rect.left, ev.clientY - rect.top);
    let closest = null, distance = 8;
    for (const e of edges) {
      if (!visibleEdge(e)) continue;
      const a = new THREE.Vector3(...byId.get(e.src).pos).project(camera), b = new THREE.Vector3(...byId.get(e.dst).pos).project(camera);
      if (a.z < -1 || a.z > 1 || b.z < -1 || b.z > 1) continue;
      const start = new THREE.Vector2((a.x + 1) * rect.width / 2, (1 - a.y) * rect.height / 2);
      const end = new THREE.Vector2((b.x + 1) * rect.width / 2, (1 - b.y) * rect.height / 2), delta = end.clone().sub(start);
      const t = THREE.MathUtils.clamp(p.clone().sub(start).dot(delta) / (delta.lengthSq() || 1), 0, 1);
      const d = p.distanceTo(start.addScaledVector(delta, t));
      if (d < distance) { closest = e; distance = d; }
    }
    return closest;
  }
  let down = null;
  renderer.domElement.addEventListener('pointerdown', ev => {
    down = ev.isPrimary && ev.button === 0 ? {id: ev.pointerId, x: ev.clientX, y: ev.clientY} : null;
  }, {signal});
  renderer.domElement.addEventListener('pointercancel', () => { down = null; }, {signal});
  renderer.domElement.addEventListener('pointerup', ev => {
    const start = down;
    down = null;
    if (!start || start.id !== ev.pointerId || Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 4 || ev.button !== 0) return;
    const id = nodeAt(ev);
    if (id) chooseNode(id);
    else { const e = edgeAt(ev); if (e) chooseNode(e.src, e, false, true); }
  }, {signal});
  renderer.domElement.addEventListener('pointermove', ev => {
    if (down?.id === ev.pointerId && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 4) down = null;
    if (ev.buttons) return;
    const id = nodeAt(ev);
    const edge = id ? null : edgeAt(ev);
    renderer.domElement.style.cursor = id || edge ? 'pointer' : '';
    renderer.domElement.title = edge ? byId.get(edge.src).label + ' → ' + byId.get(edge.dst).label + ': ' + (edge.text || edge.type || edge.kind) : '';
    if (id !== state.hovered) { state.hovered = id; rebuildLabels(state.selected ? neighborhood(state.selected) : null); listeners.hover(id); }
  }, {signal});
  renderer.domElement.addEventListener('dblclick', ev => {
    const id = nodeAt(ev);
    if (id) return focus(id);
    const hit = pick(ev, [points])[0];
    if (hit) flyTo(camera.position.clone().add(hit.point.clone().sub(controls.target)), hit.point.clone(), 450);
  }, {signal});

  function render(now) {
    if (tween) {
      const k = Math.min(1, (now - tween.t0) / tween.ms), s = 1 - Math.pow(1 - k, 3);
      camera.position.lerpVectors(tween.e0, tween.e1, s); controls.target.lerpVectors(tween.g0, tween.g1, s);
      if (k >= 1) tween = null;
    }
    controls.update();
    renderer.render(scene, camera);
    placeLabels(container.clientWidth, container.clientHeight);
  }
  if (firstMap) {
    const start = home();
    camera.position.copy(start.eye);
    controls.target.copy(start.target);
    controls.update();
  }
  const ui = graph ? graphControls(container, graph, trajectory) : null;
  const queryApiUrl = window.FUNCTIONAL_SLAM_API_URL || '/api/query';
  const usageApiUrl = queryApiUrl.replace(/\/api\/query$/, '/api/usage');
  const healthApiUrl = queryApiUrl.replace(/\/api\/query$/, '/healthz');
  let timer = null, activeQuery = '', beforeQuery = null;
  let lunaMatches = null, lunaPending = false, lunaFailure = '', queryRequest = 0;
  const committedEdges = edges.filter(edge => edge.status === 'committed');

  function refreshUsage() {
    if (!ui || signal.aborted) return;
    const server = fetch(healthApiUrl, {cache: 'no-store', signal}).then(async response => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.status !== 'ok') throw new Error('서버 상태를 확인할 수 없습니다.');
    });
    const usage = fetch(usageApiUrl, {cache: 'no-store', signal}).then(async response => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !Number.isInteger(payload.used) || !Number.isInteger(payload.limit)) {
        throw new Error('사용량 응답을 확인할 수 없습니다.');
      }
      return payload;
    });
    Promise.allSettled([server, usage]).then(([serverResult, usageResult]) => {
      if (signal.aborted) return;
      const connected = serverResult.status === 'fulfilled';
      ui.serverStatus.textContent = connected ? '백엔드 서버 연결됨' : '백엔드 서버 연결 안 됨';
      ui.serverStatus.dataset.state = connected ? 'up' : 'down';
      ui.usage.textContent = usageResult.status === 'fulfilled'
        ? `오늘 공용 GPT 의미 검색 요청 ${usageResult.value.used} / ${usageResult.value.limit}건 · 한국 시간 자정 초기화`
        : '오늘 요청량을 불러오지 못했습니다.';
    });
  }

  refreshUsage();
  const usageTimer = ui ? window.setInterval(refreshUsage, 30_000) : null;

  function showSelection() {
    if (!ui) return;
    const n = byId.get(state.selected);
    ui.detail.hidden = !n;
    if (!n) { ui.detail.textContent = ''; return; }
    const relations = (state.edge ? [state.edge] : edges.filter(e => e.src === n.id || e.dst === n.id)).filter(visibleEdge);
    ui.detail.textContent = [
      `${n.label} · ${n.role} · ${n.id}`,
      ...relations.map(e => `${byId.get(e.src).label} → ${byId.get(e.dst).label} · ${e.text || e.type || e.kind}`),
    ].join(' / ');
  }

  function select(id, fly = true) {
    if (id != null && !visibleNode(byId.get(id))) return;
    state.selected = id;
    state.edge = null;
    rebuild();
    showSelection();
    if (id && fly) focus(id);
  }

  function chooseNode(id, edge = null, fly = false, edgeClick = false) {
    if (!visibleNode(byId.get(id)) || (edge && !visibleEdge(edge))) return;
    stopPlayback();
    if (edgeClick) listeners.edge?.(edge, state.time);
    else listeners.select?.(id, state.time);
    if (state.selected !== id || state.edge !== edge) {
      state.selected = id;
      state.edge = edge;
      rebuild();
      showSelection();
    }
    if (fly) focus(id);
  }

  function renderQuery() {
    if (!ui) return;
    queryNodes.clear();
    queryEdges.clear();
    ui.resultList.replaceChildren();
    ui.results.hidden = true;
    ui.status.textContent = '';
    candidateOnly = false;
    if (!activeQuery) return;
    if (lunaPending) {
      ui.status.textContent = 'GPT-6 Luna가 선택한 그래프에서 노드를 찾고 있습니다…';
      return;
    }
    const result = lunaMatches
      ? {
          matches: lunaMatches.matches.filter(match => visibleNode(match.node))
            .map(match => ({...match, edges: match.edges.filter(visibleEdge)})),
          candidateOnly: lunaMatches.candidateOnly,
        }
      : resolveGraphQuery(activeQuery, nodes.filter(visibleNode), edges.filter(visibleEdge));
    const {matches} = result;
    candidateOnly = result.candidateOnly;
    ui.results.hidden = matches.length === 0;
    for (const {node, edges: evidence} of matches) {
      queryNodes.add(node.id);
      for (const e of evidence.length ? evidence : [null]) {
        if (e) { queryEdges.add(e); queryNodes.add(e.dst); }
        const title = `${node.label} (${node.id})` + (e ? ` → ${byId.get(e.dst).label} · ${e.text}` : '');
        ui.resultList.append(button(title, () => chooseNode(node.id, e, true, !!e)));
      }
    }
    const summary = candidateOnly
      ? `스위치 후보 ${matches.length}개를 주황색으로 표시했습니다. 조명 제어 연결은 미확정입니다.`
      : matches.length
        ? `노드 ${queryNodes.size}개 · 확정 연결 ${queryEdges.size}개를 지도에서 강조했습니다.`
        : '현재 표시한 역할과 키프레임에서 일치하는 항목이 없습니다.';
    ui.status.textContent = lunaMatches
      ? `GPT 의미 검색 · ${summary}`
      : lunaFailure
        ? `GPT 의미 검색 실패 (${lunaFailure}). 로컬 규칙 검색 결과 · ${summary}`
        : summary;
  }

  function syncTimeline() {
    if (!ui) return;
    const final = state.time === Infinity;
    const step = final ? ui.end : state.time;
    const row = final ? ui.lastRow : ui.byKeyframe.get(step);
    ui.slider.max = ui.end;
    ui.slider.value = step;
    ui.slider.setAttribute('aria-valuetext', final ? '최종 그래프' : `키프레임 ${step}`);
    ui.output.textContent = `${final ? '최종' : '#' + step + ' / ' + (ui.end - 1)} · 표시 노드 ${nodes.filter(visibleNode).length} · 연결 ${edges.filter(visibleEdge).length}`;
    ui.provenance.textContent = '3D 재구성 · 최종 위치에 노드 등장·관계 확정 기록을 적용합니다.'
      + (row ? ` 실행 로그 집계 · 노드 ${row.n_nodes} (안정 ${row.n_stable}) · 연결 ${row.n_local_edges + row.n_remote_edges} (로컬 ${row.n_local_edges} · 원격 ${row.n_remote_edges}, 확정 전 포함)` : '');
  }

  function updateGraph() {
    if (!visibleNode(byId.get(state.selected))) state.selected = null;
    if (!visibleNode(byId.get(state.hovered))) state.hovered = null;
    if (state.edge && !visibleEdge(state.edge)) state.edge = null;
    renderer.domElement.style.cursor = '';
    renderer.domElement.title = '';
    renderQuery();
    rebuild();
    showSelection();
    syncTimeline();
  }

  function setTime(time) {
    if (time !== Infinity && (!Number.isInteger(time) || time < 0)) return;
    if (time === state.time) return;
    state.time = time;
    tween = null;
    updateGraph();
    listeners.time?.(time);
  }

  function stopPlayback() {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
    ui.play.textContent = '재생';
  }

  if (ui) {
    const clear = button('강조 해제', () => { submitQuery(''); ui.input.focus(); });
    clear.hidden = true;
    function submitQuery(value) {
      stopPlayback();
      if (!activeQuery && value.trim()) beforeQuery = {eye: camera.position.clone(), target: controls.target.clone()};
      ui.input.value = value;
      activeQuery = value.trim();
      const requestId = ++queryRequest;
      lunaMatches = null;
      lunaFailure = '';
      lunaPending = !!activeQuery;
      clear.hidden = !activeQuery;
      ui.results.open = false;
      state.selected = state.edge = state.hovered = null;
      listeners.select?.(null, state.time);
      updateGraph();
      if (queryNodes.size) frameMatches();
      else if (beforeQuery) flyTo(beforeQuery.eye, beforeQuery.target);
      if (!activeQuery) {
        beforeQuery = null;
        return;
      }

      fetch(queryApiUrl, {
        method: 'POST',
        signal,
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(isDeepSeek ? {query: activeQuery, run: 'deepseek'} : {query: activeQuery}),
      }).then(async response => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
        if (isDeepSeek && payload.run !== 'deepseek') {
          throw new Error('API가 DeepSeek 실행의 그래프를 확인하지 못했습니다.');
        }
        if (!Array.isArray(payload.node_ids) || !Array.isArray(payload.edge_indices)) {
          throw new Error('응답 형식 오류');
        }
        return payload;
      }).then(payload => {
        if (signal.aborted || requestId !== queryRequest || activeQuery !== ui.input.value.trim()) return;
        lunaMatches = resolveLunaGraphQuery(payload, nodes, committedEdges);
        lunaPending = false;
        updateGraph();
        if (queryNodes.size) frameMatches();
      }).catch(error => {
        if (signal.aborted || requestId !== queryRequest || activeQuery !== ui.input.value.trim()) return;
        lunaFailure = error.message || 'API 오류';
        lunaPending = false;
        updateGraph();
        if (queryNodes.size) frameMatches();
      }).finally(refreshUsage);
    }
    ui.form.addEventListener('submit', ev => { ev.preventDefault(); submitQuery(ui.input.value); });
    ui.input.addEventListener('input', () => { if (!ui.input.value && activeQuery) submitQuery(''); });
    ui.input.addEventListener('keydown', ev => {
      if (ev.key === 'Escape' && activeQuery) { ev.preventDefault(); submitQuery(''); }
    });
    ui.form.append(clear);
    const examples = element('div');
    examples.className = 'graph-query-examples';
    examples.append(element('span', '예시'));
    ui.form.append(examples);
    const light = button(LIGHT_QUERY, () => submitQuery(LIGHT_QUERY));
    light.lang = 'en';
    examples.append(light);
    const sample = resolveGraphQuery('물 틀어줘', nodes, edges).matches.length
      ? '물 틀어줘' : graphQueryExample(nodes, edges);
    if (sample) {
      const example = button(sample, () => submitQuery(sample));
      examples.append(example);
    }
    const seek = step => setTime(step >= ui.end ? Infinity : step);
    ui.slider.addEventListener('input', () => {
      stopPlayback();
      seek(Number(ui.slider.value));
    }, {signal});
    ui.play.addEventListener('click', () => {
      if (timer !== null) { stopPlayback(); return; }
      if (state.time === Infinity) seek(0);
      ui.play.textContent = '정지';
      timer = setInterval(() => {
        seek(Number(ui.slider.value) + 1);
        if (state.time === Infinity) stopPlayback();
      }, 380);
    }, {signal});
    syncTimeline();
    const initialQuery = new URLSearchParams(window.location?.search).get('q');
    // Apply after the page selects its initial tree node.
    if (initialQuery?.trim()) queueMicrotask(() => { if (!signal.aborted) submitQuery(initialQuery); });
  }
  signal.addEventListener('abort', () => {
    stopPlayback();
    clearInterval(usageTimer);
    controls.removeEventListener('start', cancelTween);
    const geometries = new Set();
    scene.traverse(object => {
      if (object.geometry && object.parent?.type !== 'ArrowHelper') geometries.add(object.geometry);
      object.material?.dispose();
    });
    for (const geometry of geometries) geometry.dispose();
    inst.dispose();
    labels.replaceChildren();
    renderer.domElement.style.cursor = '';
    renderer.domElement.title = '';
    ui?.provenance.remove();
  }, {once: true});
  rebuild();

  return {
    render,
    onSelect(fn) { listeners.select = fn; },
    onEdgeSelect(fn) { listeners.edge = fn; },
    onTimeChange(fn) { listeners.time = fn; },
    selectEdge(e, fly = true) {
      if (!visibleEdge(e)) return;
      state.edge = e; rebuild(); showSelection();
      if (fly) {
        const a = new THREE.Vector3(...byId.get(e.src).pos), b = new THREE.Vector3(...byId.get(e.dst).pos), target = a.clone().add(b).multiplyScalar(.5);
        const direction = camera.position.clone().sub(controls.target).normalize();
        const distance = Math.max(radius * .4, a.distanceTo(b) / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.max(1, 1 / camera.aspect));
        flyTo(target.clone().addScaledVector(direction, distance), target);
      }
    },
    onHover(fn) { listeners.hover = fn; },
    select,
    setRoles(set) { state.roles = set; updateGraph(); },
    setTime(time) { stopPlayback(); setTime(time); },
    setCloud(on) { points.visible = on; },
    setTrajectory(on) { traj.visible = on; },
    setPointSize(k) { pointMat.size = radius * 0.0015 * k; },
    reset() { const h = home(); flyTo(h.eye, h.target); },
  };
}
