import {LocalParentPosterior, DEFAULTS} from './posterior-core.js';

const EVIDENCE = {A: {A: 0.8}, B: {B: 0.8}, AB: {A: 0.55, B: 0.45}, none: null};
const LABEL = {A: 'A', B: 'B', AB: 'A·B', none: '–'};
const CYCLE = ['A', 'B', 'AB', 'none'];
const PRESETS = {
  occlusion: ['A', 'A', 'B', 'A', 'A', 'none', 'A', 'A', 'A', 'A'],
  boundary: ['AB', 'AB', 'AB', 'A', 'AB', 'AB', 'A', 'A', 'AB', 'A'],
  late: ['B', 'B', 'A', 'A', 'A', 'A', 'A', 'A', 'A', 'A'],
};
const CHECK_TEXT = {
  support: '1위 후보를 지지한 프레임 3개 이상',
  recent: '최근 3프레임 안에서 3번 지지',
  margin: '누적 점수 차 1.5 이상',
  step: '이번 프레임 점수 차 0.5 이상 (경쟁 후보가 있을 때)',
  switches: '최근 1위가 바뀐 횟수 1번 이하',
  consistent: '최근 3번의 1위가 모두 같음',
};

function simulate(seq) {
  const post = new LocalParentPosterior();
  return seq.map((kind, frame) => {
    const evidence = EVIDENCE[kind];
    if (evidence) post.update(frame, evidence, DEFAULTS);
    const naive = evidence ? Object.entries(evidence).sort((a, b) => b[1] - a[1])[0][0] : null;
    return {
      kind, naive, observed: !!evidence,
      A: post.scores.get('A') ?? 0, B: post.scores.get('B') ?? 0,
      top1: post.top1, ready: post.commitReady(DEFAULTS),
      checks: post.top1 === null ? [] : post.checks(DEFAULTS),
      unresolved: post.unresolved(DEFAULTS),
    };
  });
}

export function mountPosteriorDemo() {
  const grid = document.getElementById('post-grid'), checks = document.getElementById('post-checks');
  let seq = [...PRESETS.occlusion], focus = seq.length - 1;
  const presetButtons = [...document.querySelectorAll('[data-preset]')];

  function cell(text, cls = '') { const d = document.createElement('div'); d.className = cls; d.textContent = text; return d; }

  function render() {
    const rows = simulate(seq), max = Math.max(1.6, ...rows.flatMap(r => [r.A, r.B]));
    grid.style.setProperty('--n', seq.length);
    grid.replaceChildren();
    grid.append(cell('프레임', 'rowh colh'));
    rows.forEach((_, i) => {
      const h = cell(String(i + 1), 'colh' + (i === focus ? ' sel' : ''));
      grid.append(h);
    });
    grid.append(cell('관측', 'rowh'));
    rows.forEach((r, i) => {
      const wrap = cell('', i === focus ? 'sel' : '');
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'obs-cell ' + r.kind; b.textContent = LABEL[r.kind];
      b.setAttribute('aria-label', (i + 1) + '번째 프레임 관측: ' + LABEL[r.kind] + '. 눌러서 바꾸기');
      b.addEventListener('click', () => {
        seq[i] = CYCLE[(CYCLE.indexOf(seq[i]) + 1) % CYCLE.length];
        focus = i; presetButtons.forEach(p => p.setAttribute('aria-pressed', 'false')); render();
      });
      wrap.append(b); grid.append(wrap);
    });
    grid.append(cell('누적 점수', 'rowh'));
    rows.forEach((r, i) => {
      const wrap = cell('', i === focus ? 'sel' : '');
      const bars = document.createElement('div'); bars.className = 'bars';
      for (const k of ['A', 'B']) {
        const bar = document.createElement('div'); bar.className = 'bar ' + k; bar.style.width = (100 * r[k] / max) + '%';
        bar.title = k + ' ' + r[k].toFixed(2); bars.append(bar);
      }
      const lab = document.createElement('span'); lab.className = 'bar-label'; lab.textContent = r.A.toFixed(1) + ' / ' + r.B.toFixed(1);
      bars.append(lab); wrap.append(bars); grid.append(wrap);
      wrap.addEventListener('click', () => { focus = i; render(); });
    });
    grid.append(cell('Functional-SLAM', 'rowh'));
    rows.forEach((r, i) => {
      const wrap = cell('', i === focus ? 'sel' : '');
      const s = document.createElement('span');
      s.className = 'state ' + (r.ready ? 'commit' : 'hold');
      s.textContent = r.ready ? r.top1 + ' 확정' : '보류';
      wrap.append(s); grid.append(wrap);
      wrap.addEventListener('click', () => { focus = i; render(); });
    });
    grid.append(cell('한 프레임만 보면', 'rowh'));
    rows.forEach((r, i) => {
      const wrap = cell(r.naive ?? '–', 'naive ' + (r.naive ?? '') + (i === focus ? ' sel' : ''));
      grid.append(wrap);
    });
    const r = rows[focus];
    checks.replaceChildren();
    const h = document.createElement('h4');
    h.textContent = (focus + 1) + '번째 프레임 판정: ' + (r.ready ? '문 ' + r.top1 + '에 연결 확정' : '보류') + (r.top1 ? ' · 누적 1위 ' + r.top1 : '');
    const ul = document.createElement('ul');
    if (!r.checks.length) { const li = document.createElement('li'); li.textContent = '아직 관측이 없습니다.'; ul.append(li); }
    for (const [key, ok] of r.checks) {
      const li = document.createElement('li'); li.className = ok ? 'ok' : 'fail'; li.textContent = CHECK_TEXT[key]; ul.append(li);
    }
    if (r.unresolved) { const li = document.createElement('li'); li.className = 'fail'; li.textContent = '5번 이상 모호해 미해결로 분류됨 (원 코드는 이때 추가 질의를 요청)'; ul.append(li); }
    checks.append(h, ul);
  }

  presetButtons.forEach(b => b.addEventListener('click', () => {
    seq = [...PRESETS[b.dataset.preset]]; focus = seq.length - 1;
    presetButtons.forEach(p => p.setAttribute('aria-pressed', String(p === b))); render();
  }));
  render();
}
