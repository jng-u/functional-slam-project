// Concept illustration for anchor-keyframe geometry. All geometry here is synthetic.
const N = 13, OBS = 8;
const rot = (a, [x, y]) => [Math.cos(a) * x - Math.sin(a) * y, Math.sin(a) * x + Math.cos(a) * y];
const apply = (pose, p) => { const [x, y] = rot(pose.a, p); return [x + pose.x, y + pose.y]; };
const inverse = (pose, p) => rot(-pose.a, [p[0] - pose.x, p[1] - pose.y]);
const lerp = (a, b, t) => a + (b - a) * t;

// True camera loop around a kitchen, looking at the walls.
const truth = Array.from({length: N}, (_, i) => {
  const s = i / (N - 1) * Math.PI * 2;
  return {x: 1.55 * Math.cos(s), y: 1.05 * Math.sin(s), a: s + Math.PI};
});
// Drift grows along the trajectory: heading error and a scale-like offset.
const drifted = truth.map((pose, i) => {
  const k = i / (N - 1);
  const err = {x: 0.55 * k * k, y: -0.42 * k, a: 0.32 * k};
  const [x, y] = rot(err.a, [pose.x, pose.y]);
  return {x: x + err.x, y: y + err.y, a: pose.a + err.a};
});
const corrected = t => drifted.map((d, i) => ({x: lerp(d.x, truth[i].x, t), y: lerp(d.y, truth[i].y, t), a: lerp(d.a, truth[i].a, t)}));

// Kitchen walls sampled as points; each keyframe "sees" the wall points nearest to it.
const walls = [];
for (let i = 0; i <= 60; i++) { const u = i / 60; walls.push([-2.2 + 4.4 * u, -1.6], [-2.2 + 4.4 * u, 1.6]); }
for (let i = 0; i <= 40; i++) { const u = i / 40; walls.push([-2.2, -1.6 + 3.2 * u], [2.2, -1.6 + 3.2 * u]); }
const scans = truth.map(pose => walls.filter(w => Math.hypot(w[0] - pose.x, w[1] - pose.y) < 1.55).map(w => inverse(pose, w)));
const cabinet = [[0.15, 1.6], [0.95, 1.6]];
const handle = [0.62, 1.42];
const handleLocal = inverse(truth[OBS], handle);
const cabinetLocal = cabinet.map(p => inverse(truth[OBS], p));
const handleLast = inverse(truth[N - 1], handle);

function draw(canvas, t, anchored) {
  const ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height, s = 86;
  const P = ([x, y]) => [W / 2 + x * s, H / 2 - y * s];
  ctx.clearRect(0, 0, W, H);
  const poses = corrected(t);
  ctx.fillStyle = '#9aa69f';
  poses.forEach((pose, i) => scans[i].forEach(p => { const [x, y] = P(apply(pose, p)); ctx.fillRect(x - 1, y - 1, 2, 2); }));
  ctx.strokeStyle = '#c7ccc6'; ctx.lineWidth = 1.5; ctx.setLineDash([]);
  ctx.beginPath(); truth.forEach((p, i) => { const [x, y] = P([p.x, p.y]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
  ctx.strokeStyle = '#3c4a46'; ctx.setLineDash([5, 4]);
  ctx.beginPath(); poses.forEach((p, i) => { const [x, y] = P([p.x, p.y]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
  ctx.setLineDash([]);
  poses.forEach((pose, i) => {
    const [x, y] = P([pose.x, pose.y]);
    ctx.fillStyle = i === OBS ? '#0b6e64' : '#3c4a46';
    ctx.beginPath(); ctx.arc(x, y, i === OBS ? 5 : 3, 0, 7); ctx.fill();
  });
  // The cabinet is part of the anchor keyframe's own reconstruction.
  const [c0, c1] = cabinetLocal.map(p => P(apply(poses[OBS], p)));
  ctx.strokeStyle = '#c27a24'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(...c0); ctx.lineTo(...c1); ctx.stroke();
  const node = anchored ? apply(poses[OBS], handleLocal) : apply(drifted[OBS], handleLocal);
  const again = apply(poses[N - 1], handleLast);
  const [hx, hy] = P(node), [rx, ry] = P(again);
  ctx.strokeStyle = '#12876f'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
  const [ax, ay] = P([poses[OBS].x, poses[OBS].y]);
  if (anchored) { ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(hx, hy); ctx.stroke(); }
  ctx.setLineDash([]);
  ctx.fillStyle = '#12876f'; ctx.beginPath(); ctx.arc(hx, hy, 7, 0, 7); ctx.fill();
  ctx.strokeStyle = '#8a4f9e'; ctx.lineWidth = 2; ctx.beginPath();
  ctx.moveTo(rx, ry - 7); ctx.lineTo(rx + 7, ry); ctx.lineTo(rx, ry + 7); ctx.lineTo(rx - 7, ry); ctx.closePath(); ctx.stroke();
  const gap = Math.hypot(node[0] - again[0], node[1] - again[1]);
  ctx.font = '600 13px Pretendard, "Noto Sans KR", sans-serif';
  ctx.fillStyle = gap > 0.18 ? '#b54a3a' : '#0b6e64';
  ctx.fillText(gap > 0.18 ? '다시 본 손잡이와 어긋남 → 중복 노드' : '다시 본 손잡이와 일치', 12, H - 14);
}

export function mountAnchorDemo() {
  const world = document.getElementById('anchor-world'), local = document.getElementById('anchor-local');
  const input = document.getElementById('anchor-t'), out = document.getElementById('anchor-out');
  const render = () => {
    const t = Number(input.value) / 100;
    out.textContent = input.value + '%';
    draw(world, t, false); draw(local, t, true);
  };
  input.addEventListener('input', render);
  render();
}
