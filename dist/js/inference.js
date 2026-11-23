// Shows what the official perception stage inferred per frame: RAM++ tags and the
// LLM-inferred O/C/U targets (scene atlas + per-frame additions) handed to SAM3.
const NS = 'http://www.w3.org/2000/svg';
const $ = id => document.getElementById(id);
const norm = s => s.toLowerCase().trim().replace(/[\s-]+/g, '_');
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
function svg(tag, attrs = {}, text) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
}
const matches = (tag, target) => tag === target || tag.endsWith('_' + target) || target.endsWith('_' + tag);
// Every O, C and U name the frame's target list mentions.
function vocabulary(catalog, targets) {
  const names = [];
  for (const t of targets) {
    const o = catalog.get(t); names.push(norm(t));
    if (!o) continue;
    for (const c of o.carriers) { names.push(norm(c.name)); for (const u of c.units) names.push(norm(u.name)); }
    for (const u of o.direct) names.push(norm(u.name));
  }
  return names;
}

export function mountInference(data, frames, {hasGraph = false, signal} = {}) {
  const box = $('inference'); box.hidden = false;
  const catalog = new Map(data.objects.map(o => [o.object, o]));
  const added = Object.entries(data.first_frame);
  $('inf-lede').textContent = hasGraph
    ? '사진은 SAM3의 2D 관측입니다. 도식에는 언어 모델이 고른 탐색 대상과 관계 후보를 표시합니다.'
    : '사전 추론에서 찾은 대상과 관계 후보입니다.';
  const scene = data.scene;
  $('inf-meta').textContent = `장면 분류는 ${scene.locked_at_frame + 1}번째 프레임에서 ${scene.scene_type}으로 확정됐습니다. 장면 사전의 물체 ${data.atlas_objects.length}개를 모든 프레임에서 탐색하고, 프레임 태그를 보고 대상을 추가합니다. 캐시의 고유 응답 수는 ${data.llm_calls ?? '기록 없음'}입니다.`;

  // Concrete kitchen objects that RAM++ saw but the language model never turned into targets.
  const watch = ['cabinet', 'drawer', 'dish_washer', 'oven', 'stove', 'exhaust_hood', 'kettle', 'washer', 'toaster', 'blender', 'door', 'coffee_machine', 'refrigerator', 'microwave', 'faucet'];
  const seen = new Map(), targeted = new Set();
  data.frames.forEach(f => {
    const tg = vocabulary(catalog, f.targets);
    for (const t of f.tags.map(norm)) {
      if (!watch.includes(t)) continue;
      seen.set(t, (seen.get(t) ?? 0) + 1);
      if (tg.some(o => matches(t, o))) targeted.add(t);
    }
  });
  const missed = [...seen].filter(([t]) => !targeted.has(t)).sort((a, b) => b[1] - a[1]);
  $('inf-note').textContent = (missed.length
    ? '탐색 대상과 이름이 일치하지 않은 RAM++ 태그는 ' + missed.map(([t, n]) => t.replace(/_/g, ' ') + ' ' + n + '장').join(', ') + '입니다. '
    : '')
    + '프레임 태그에서 새로 추가된 대상: ' + added.map(([o, i]) => o + '(' + (i + 1) + '번째)').join(', ') + '.';

  const slider = $('inf-frame'); slider.max = data.frames.length - 1;
  const pick = added.length ? added[added.length - 1][1] : 0;
  slider.value = pick;
  slider.addEventListener('input', () => show(Number(slider.value)), {signal});
  $('inf-prev').addEventListener('click', () => { slider.value = Math.max(0, Number(slider.value) - 1); show(Number(slider.value)); }, {signal});
  $('inf-next').addEventListener('click', () => { slider.value = Math.min(data.frames.length - 1, Number(slider.value) + 1); show(Number(slider.value)); }, {signal});
  let mode = 'sam3';
  $('inf-sam3').addEventListener('click', () => { mode = 'sam3'; show(Number(slider.value)); }, {signal});
  $('inf-photo').addEventListener('click', () => { mode = 'photo'; show(Number(slider.value)); }, {signal});
  show(pick);

  function show(i) {
    const f = data.frames[i];
    const frame = frames[i], overlay = !!frame?.segmentation_url;
    const useOverlay = mode === 'sam3' && overlay;
    $('inf-sam3').disabled = !overlay;
    $('inf-sam3').setAttribute('aria-pressed', String(useOverlay));
    $('inf-photo').setAttribute('aria-pressed', String(!useOverlay));
    $('inf-image-state').textContent = (useOverlay ? 'SAM3 마스크와 라벨' : overlay ? '원본 RGB 사진' : 'SAM3 기록 없음 · 원본 사진') + ' · ' + (frame?.name || '프레임 정보 없음');
    const image = document.createElement('img'); image.alt = $('inf-image-state').textContent;
    image.src = (useOverlay ? frame.segmentation_url : frame?.url) || '';
    image.addEventListener('error', () => { $('inf-img').replaceChildren(document.createTextNode('이미지를 불러오지 못했습니다. 원본 사진 또는 다른 프레임을 선택하세요.')); }, {signal});
    $('inf-img').replaceChildren(image);
    $('inf-img').setAttribute('aria-label', image.alt);
    $('inf-out').textContent = (i + 1) + ' / ' + data.frames.length + (f.added.length ? ' · 대상 추가' : '');
    const targets = vocabulary(catalog, f.targets);
    const tags = $('inf-tags'); tags.replaceChildren();
    for (const t of f.tags) {
      const s = document.createElement('span');
      s.className = 'tag' + (targets.some(o => matches(norm(t), o)) ? ' hit' : '');
      s.textContent = t; tags.append(s);
    }
    draw(f);
  }

  function draw(f) {
    const root = $('inf-svg'); root.replaceChildren();
    const X = {u: 8, c: 300, o: 560}, W = {u: 158, c: 150, o: 170}, H = 24, ROW = 30, GAP = 14;
    const defs = svg('defs'); const mk = svg('marker', {id: 'inf-arr', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto'});
    mk.append(svg('path', {d: 'M0 0 10 5 0 10z', fill: '#8d9a94'})); defs.append(mk); root.append(defs);
    root.append(svg('text', {x: X.u, y: 14, class: 'col'}, 'U 조작 부위'), svg('text', {x: X.c, y: 14, class: 'col'}, 'C 중간 부품'), svg('text', {x: X.o, y: 14, class: 'col'}, 'O 물체'));
    const edges = svg('g'), nodes = svg('g'); root.append(edges, nodes);
    const node = (col, y, label, cls, title) => {
      const g = svg('g', {class: 'n ' + col + (cls ? ' ' + cls : '')});
      g.append(svg('rect', {x: X[col], y: y - H / 2, width: W[col], height: H, rx: col === 'u' ? 12 : col === 'c' ? 5 : 2}));
      g.append(svg('text', {x: X[col] + 9, y: y + 4.5}, cut(label, col === 'o' ? 22 : 19)));
      if (title) g.append(svg('title', {}, title));
      g.addEventListener('click', () => { $('inf-svg-cap').textContent = title || label; });
      nodes.append(g);
    };
    const link = (x1, y1, x2, y2, label, title) => {
      const mx = (x1 + x2) / 2;
      const p = svg('path', {d: `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2 - 2} ${y2}`, class: 'e', 'marker-end': 'url(#inf-arr)'});
      if (title) p.append(svg('title', {}, title));
      edges.append(p);
      if (label) edges.append(svg('text', {x: x1 + 6, y: y1 - 5, class: 'lab'}, cut(label, Math.round((x2 - x1) / 6.2))));
    };
    let y = 36; const oY = new Map();
    for (const name of f.targets) {
      const o = catalog.get(name); if (!o) continue;
      const fresh = f.added.includes(name) ? 'new' : '';
      const top = y, rows = [];
      for (const c of o.carriers) {
        const ys = [];
        for (const u of c.units) { ys.push(y); rows.push(y); y += ROW; }
        if (!ys.length) { ys.push(y); rows.push(y); y += ROW; }
        const cy = ys.reduce((a, b) => a + b, 0) / ys.length;
        c.units.forEach((u, k) => {
          node('u', ys[k], u.name, fresh, u.name + ' → ' + c.name + ': ' + u.rel + (u.effect ? ' · 효과: ' + u.effect : ''));
          link(X.u + W.u, ys[k], X.c, cy, u.rel, u.rel);
        });
        c._y = cy;
        node('c', cy, c.name, fresh, c.name + ' → ' + name + ': ' + (c.rel || 'part of'));
      }
      for (const u of o.direct) { node('u', y, u.name, fresh, u.name + ' → ' + name + ' (직접): ' + u.effect); rows.push(y); u._y = y; y += ROW; }
      if (!rows.length) { rows.push(y); y += ROW; }
      const oy = (rows[0] + rows[rows.length - 1]) / 2; oY.set(name, oy);
      for (const c of o.carriers) link(X.c + W.c, c._y, X.o, oy, '', c.rel || 'part of');
      for (const u of o.direct) link(X.u + W.u, u._y, X.o, oy, u.effect, u.effect);
      node('o', oy, name, fresh, name + (fresh ? ' · 이 프레임의 태그에서 추가' : ' · 장면 기능 사전'));
      y += GAP;
      if (top === y) y += ROW;
    }
    for (const [a, b, rel] of f.remote) {
      const ya = oY.get(a), yb = oY.get(b); if (ya == null || yb == null) continue;
      const xr = X.o + W.o, bend = xr + 26 + Math.min(40, Math.abs(yb - ya) / 6);
      const p = svg('path', {d: `M${xr} ${ya} C${bend} ${ya} ${bend} ${yb} ${xr + 2} ${yb}`, class: 'e remote'});
      p.append(svg('title', {}, a + ' ⇢ ' + b + ': ' + rel)); edges.append(p);
      edges.append(svg('text', {x: bend - 10, y: (ya + yb) / 2 + 4, class: 'lab', 'text-anchor': 'end'}, cut(rel, 18)));
    }
    root.setAttribute('viewBox', '0 0 790 ' + (y + 4));
    $('inf-svg-cap').textContent = '노드나 선에 마우스를 올리면 관계 원문을 볼 수 있습니다.';
  }
}
