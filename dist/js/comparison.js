const LUNA = 'GPT-6 Luna';
const DEEPSEEK = 'DeepSeek V4.1 Flash';
const EXACT_MODEL = 'opencode-go/deepseek-v4.1-flash';

function el(tag, text, cls) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}

async function read(path, optional = false) {
  const res = await fetch(path);
  if (optional && res.status === 404) return null;
  if (!res.ok) throw new Error(path + ' (' + res.status + ')');
  return res.json();
}

async function experiment(base, name, run) {
  const [graph, inference, summary] = await Promise.all([
    read(base + run.graph), read(base + run.inference), read(base + 'summary.json'),
  ]);
  return {base, name, run, graph, inference, summary};
}

const number = (value, digits = 0) => Number.isFinite(value)
  ? value.toLocaleString('ko-KR', {minimumFractionDigits: digits, maximumFractionDigits: digits})
  : '미측정';

const usd = value => Number.isFinite(value) ? '$' + value.toFixed(5) : '—';

function combinedUsage(summary, field) {
  const groups = [summary.api_usage, summary.reused_api_usage].filter(Boolean);
  if (!groups.length || !groups.every(group => Number.isFinite(group[field]))) return undefined;
  return groups.reduce((total, group) => total + group[field], 0);
}

export function renderGraphRecall(run, model = LUNA) {
  const column = model === DEEPSEEK ? 3 : 2;
  const accuracy = run.accuracy;
  let measured = false;
  for (const row of document.querySelectorAll('#results [data-graph-metric]')) {
    const path = row.dataset.graphMetric;
    const isCount = path.startsWith('reference_');
    const value = path.split('.').reduce((entry, key) => entry?.[key], accuracy?.graph_recall);
    if (!isCount && Number.isFinite(value)) measured = true;
    const displayValue = path === 'nodes.overall.r3' && !Number.isFinite(value)
      ? accuracy?.node_recall_at_3
      : value;
    row.cells[column].textContent = number(displayValue, isCount ? 0 : 2);
  }
  if (measured) document.getElementById('graph-recall-method').hidden = false;
}

const displayedEdges = (x, kind) => x.graph.edges.filter(e => e.kind === kind).length;

const graphFields = [
  ['3D 노드 수', x => x.graph.nodes.length],
  ['확정 로컬 연결', x => displayedEdges(x, 'local')],
  ['확정 원격 연결', x => displayedEdges(x, 'remote')],
  ['기능 루프 후보 (검증 통과 / 제안)', x => {
    const loops = x.run.loops;
    return loops ? number(loops.functional_accepted) + ' / ' + number(loops.functional_proposed) : '미측정';
  }],
];

const performanceFields = [
  ['처리 프레임', x => x.run.frames_processed],
  ['실행 시간 (초)', x => x.summary.wall_seconds, 1],
  ['처리 속도 (FPS)', x => x.run.fps, 3],
  ['시작 시 LLM 캐시', x => ({cold: '비어 있음', reused: '이전 응답 재사용'})[x.run.llm?.cache_mode]],
  ['모델 추론 설정', x => ({low: '낮음 (low)', none: '끄기 (none)'})[x.run.llm?.reasoning_effort]],
  ['GPU', x => x.run.gpu],
  ['키프레임', x => x.run.keyframes],
  ['점군 점 수', x => x.run.map.count],
  ['기준 자세와 매칭된 키프레임', x => x.run.accuracy?.matched_keyframes],
  ['ATE RMSE · Sim(3) (mm)', x => x.run.accuracy?.sim3?.ate_rmse_mm, 2],
  ['ATE RMSE · SE(3) (mm)', x => x.run.accuracy?.se3?.ate_rmse_mm, 2],
  ['Sim(3) 정렬 스케일', x => x.run.accuracy?.sim3?.scale, 4],
];

const detailFields = [
  ['장면 분류', x => x.inference.scene?.scene_type],
  ['장면 분류 신뢰도', x => x.inference.scene?.confidence, 2],
  ['장면 확정 프레임', x => {
    const i = x.inference.scene?.locked_at_frame;
    return Number.isInteger(i) && i >= 0 ? i + 1 : null;
  }],
  ['장면 사전 물체', x => x.inference.atlas_objects.length],
  ['장면 사전 원격 관계 후보', x => x.inference.atlas_remote.length],
  ['태그로 추가한 대상 종류', x => Object.keys(x.inference.first_frame).length],
  ['로컬 캐시의 고유 응답', x => x.inference.llm_calls],
  ['SAM3 해상도 설정', x => x.summary.sam3.resolution],
  ['SAM3 검출 프레임', x => x.summary.sam3.frames_with_detections],
  ['SAM3 검출 합계', x => x.summary.sam3.detections],
  ['추적한 3D 노드', x => x.graph.summary.tracked_nodes],
  ['위치 있는 노드', x => x.graph.summary.posed_nodes],
  ['위치 없는 노드', x => x.graph.summary.unposed_nodes],
  ['내보내기에서 숨긴 노드', x => x.graph.summary.hidden_nodes],
  ...[['O', '물체'], ['C', '중간 부품'], ['U', '조작 부위']].map(([role, label]) =>
    [label + ' (' + role + ') · 추적 / 3D 표시', x => {
      const {total_role_counts: total, posed_role_counts: posed} = x.graph.summary;
      return number(total?.[role]) + ' / ' + number(posed?.[role]);
    }]),
  ...['local', 'remote'].flatMap(kind => {
    const label = kind === 'local' ? '로컬' : '원격';
    return [
      [label + ' 연결 · 3D 표시', x => displayedEdges(x, kind)],
      [label + ' 연결 · 확정', x => x.graph.summary.edge_status_counts[kind + '_committed'] ?? 0],
      [label + ' 연결 · 잠정', x => x.graph.summary.edge_status_counts[kind + '_tentative'] ?? 0],
    ];
  }),
  ['루프 검색 횟수', x => x.run.loops?.events.length],
  ['영상 검색 후보', x => x.run.loops?.visual_candidates],
  ['기능 루프 후보 제안', x => x.run.loops?.functional_proposed],
  ['제안 후보 중 기하 검증 통과', x => x.run.loops?.functional_accepted],
  ['기능으로 보강한 후보', x => x.run.loops?.functional_strengthened],
  ['새 LLM 응답', x => x.summary.api_usage?.successful_responses],
  ['새 응답의 입력 토큰', x => x.summary.api_usage?.prompt_tokens],
  ['새 응답의 출력 토큰', x => x.summary.api_usage?.completion_tokens],
  ['새 응답의 전체 토큰', x => x.summary.api_usage?.total_tokens],
  ['새 응답의 캐시 쓰기 토큰', x => x.summary.api_usage?.cache_write_tokens],
  ['새 응답의 토큰 정가', x => usd(x.summary.api_usage?.list_cost_usd)],
  ['캐시 생성에 쓴 응답 수', x => x.summary.reused_api_usage?.successful_responses],
  ['캐시 생성에 쓴 토큰 수', x => x.summary.reused_api_usage?.total_tokens],
  ['캐시 생성에 쓴 응답의 토큰 정가', x => usd(x.summary.reused_api_usage?.list_cost_usd)],
  ['OpenCode Go 구독 한도 차감액', x => usd(combinedUsage(x.summary, 'allowance_usd'))],
  ['OpenCode Go 추가 청구액 · 기록 기준', x => usd(combinedUsage(x.summary, 'extra_cost_usd'))],
];

function table(label, rows) {
  const wrap = el('div', null, 'table-wrap');
  wrap.tabIndex = 0;
  wrap.setAttribute('role', 'region');
  wrap.setAttribute('aria-label', label);
  const t = el('table', null, 'compare-table');
  const head = t.createTHead().insertRow();
  for (const title of [label, LUNA, DEEPSEEK]) {
    const h = el('th', title);
    h.scope = 'col';
    head.append(h);
  }
  const body = t.createTBody();
  for (const [caption, left, right] of rows) {
    const row = body.insertRow();
    const h = el('th', caption);
    h.scope = 'row';
    row.append(h, el('td', left), el('td', right));
  }
  wrap.append(t);
  return wrap;
}

function disclosure(title, ...contents) {
  const d = el('details', null, 'project-detail');
  d.append(el('summary', title), ...contents);
  return d;
}

function tally(items) {
  const counts = new Map();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return counts;
}

function countsTable(title, left, right) {
  const keys = [...new Set([...left.keys(), ...(right?.keys() ?? [])])].sort((a, b) => a.localeCompare(b));
  return table(title, keys.map(k => [k, number(left.get(k) ?? 0), right ? number(right.get(k) ?? 0) : '—']));
}

function nodeLabels(graph) {
  return tally(graph.nodes.map(n => n.role + ' · ' + n.label));
}

function relations(graph) {
  const labels = new Map(graph.nodes.map(n => [n.id, n.role + ' ' + n.label]));
  return tally(graph.edges.map(e => {
    const kind = e.kind === 'remote' ? '원격' : e.type ?? '로컬';
    return kind + ' · ' + labels.get(e.src) + ' → ' + labels.get(e.dst) + (e.text ? ' · ' + e.text : '');
  }));
}

function localTargets(objects, labels) {
  const targets = new Set(labels);
  const rows = [];
  for (const object of objects) {
    if (!targets.has(object.object)) continue;
    for (const carrier of object.carriers) {
      rows.push('C ' + carrier.name + ' → O ' + object.object + ' · ' + (carrier.rel || 'part of'));
      for (const unit of carrier.units) {
        rows.push('U ' + unit.name + ' → C ' + carrier.name + ' → O ' + object.object
          + [unit.rel, unit.effect].filter(Boolean).map(text => ' · ' + text).join(''));
      }
    }
    for (const unit of object.direct) {
      rows.push('U ' + unit.name + ' → O ' + object.object + (unit.effect ? ' · ' + unit.effect : ''));
    }
  }
  return tally(rows);
}

function observationLink(x, frame) {
  const url = new URL('./', location.href);
  const run = x.base === 'data/' ? 'luna' : 'deepseek';
  if (run === 'deepseek') url.searchParams.set('run', run);
  url.searchParams.set('frame', String(frame));
  url.hash = 'inference';
  const a = el('a', '관측 자세히');
  a.href = url.href;
  a.dataset.run = run;
  a.setAttribute('aria-label', x.name + ' 프레임 관측 자세히');
  return a;
}

function imageURL(x, path) {
  return path?.startsWith('data/') ? x.base + path.slice(5) : path;
}

function loopCandidates(x, frame) {
  const keyframe = x.run.trajectory.find(k => k.frame === frame);
  if (!keyframe) return '키프레임 아님';
  const event = x.run.loops?.events.find(e => e.kf === keyframe.kf);
  if (!event) return '루프 검색 기록 없음';
  const sourceFrames = ids => ids.map(id => {
    const match = x.run.trajectory.find(k => k.kf === id);
    return match ? x.run.frames[match.frame].name : 'KF ' + id;
  }).join(', ') || '없음';
  return [
    ['영상', event.visual], ['추가', event.proposed], ['통과', event.accepted], ['보강', event.strengthened],
  ].map(([label, ids]) => label + ' ' + sourceFrames(ids)).join(' / ');
}

function frameControl(frames, initial) {
  const label = el('label', '프레임 ');
  const slider = el('input');
  slider.type = 'range';
  slider.min = 0;
  slider.max = frames.length - 1;
  slider.value = initial;
  label.append(slider);
  const frameName = el('output');
  const controls = el('div', null, 'compare-frame-controls');
  const prev = el('button', '이전', 'compare-button');
  const next = el('button', '다음', 'compare-button');
  prev.type = next.type = 'button';
  controls.append(label, prev, next, frameName);
  for (const [button, delta] of [[prev, -1], [next, 1]]) {
    button.addEventListener('click', () => {
      slider.value = Number(slider.value) + delta;
      slider.dispatchEvent(new Event('input'));
    });
  }
  const announce = () => {
    const i = Number(slider.value);
    frameName.textContent = i + 1 + ' / ' + frames.length + ' · ' + frames[i].name;
    slider.setAttribute('aria-valuetext', frameName.textContent);
    prev.disabled = i === 0;
    next.disabled = i === frames.length - 1;
  };
  slider.addEventListener('input', announce);
  announce();
  return {slider, controls};
}

function frameBrowser(left, right) {
  const box = el('div', null, 'compare-frame');
  const {slider, controls} = frameControl(left.run.frames, 0);
  const photoToggle = el('label', '원본 RGB 표시');
  photoToggle.className = 'compare-photo-toggle';
  const photo = el('input');
  photo.type = 'checkbox';
  photoToggle.prepend(photo);
  const images = el('div', null, 'compare-media compare-stills');
  const info = el('div');
  const details = el('div', null, 'compare-frame-details');
  box.append(controls, photoToggle, images, info, disclosure('프레임 태그와 관계 후보', details));

  const paint = () => {
    const i = Number(slider.value);
    const filename = left.run.frames[i].name;
    images.replaceChildren();
    for (const x of [left, right].filter(Boolean)) {
      const f = x.run.frames[i];
      const fig = el('figure'), img = el('img');
      const mask = !photo.checked && f.segmentation_url;
      img.src = imageURL(x, mask || f.url);
      img.alt = x.name + ' · ' + (mask ? 'SAM3 검출' : '원본 RGB') + ' · ' + filename;
      const caption = el('figcaption', x.name, 'project-caption');
      if (!photo.checked && !mask) caption.append(' · 원본 RGB');
      caption.append(' · ', observationLink(x, i));
      fig.append(img, caption);
      images.append(fig);
    }
    const list = values => values?.join(', ') || '없음';
    const rows = fields => fields.map(([key, value]) => [key, value(left), right ? value(right) : '—']);
    const frameFields = [
      ['SAM3 라벨별 검출 수', x => {
        const counts = x.summary.sam3.by_frame?.[i];
        return counts ? list(Object.entries(counts).map(([k, n]) => k + ' ' + n)) : '미측정';
      }],
      ['키프레임 위치 오차 · Sim(3) (mm)', x => {
        const value = x.run.accuracy?.per_keyframe?.find(k => k.image === filename)?.translation_error_mm;
        return Number.isFinite(value) ? number(value, 2) : '기록 없음';
      }],
      ['루프 후보와 검증 결과', x => loopCandidates(x, i)],
    ];
    info.replaceChildren(table('프레임별 결과', rows(frameFields)));
    const targetFields = [
      ['RAM++ 태그', x => list(x.inference.frames[i]?.tags)],
      ['SAM3 탐색 대상', x => list(x.inference.frames[i]?.targets)],
      ['추가 탐색 대상', x => list(x.inference.frames[i]?.added)],
      ['원격 관계 후보', x => list(x.inference.frames[i]?.remote?.map(([a, b, text]) => a + ' → ' + b + (text ? ' · ' + text : '')))],
    ];
    const targets = x => localTargets(x.inference.objects, x.inference.frames[i]?.targets ?? []);
    details.replaceChildren(
      table('프레임별 탐색 대상', rows(targetFields)),
      countsTable('로컬 관계 후보', targets(left), right && targets(right)),
    );
  };
  slider.addEventListener('input', paint);
  photo.addEventListener('change', paint);
  paint();
  return box;
}

function videos(left, right) {
  const panel = el('div');
  const wrap = el('div', null, 'compare-media compare-clips');
  const clips = [];
  for (const x of [left, right]) {
    const fig = el('figure');
    const video = el('video');
    video.controls = true;
    video.playsInline = true;
    video.preload = 'none';
    video.src = x.base + 'demo.mp4';
    video.setAttribute('aria-label', x.name + ' 실행 영상');
    video.poster = imageURL(x, x.run.frames[37]?.url);
    clips.push(video);
    fig.append(video, el('figcaption', x.name, 'project-caption'));
    wrap.append(fig);
  }
  const play = el('button', '두 영상 처음부터 재생', 'compare-button');
  play.type = 'button';
  const status = el('p', null, 'project-caption');
  status.setAttribute('role', 'status');
  play.addEventListener('click', () => {
    status.textContent = '';
    for (const clip of clips) clip.currentTime = 0;
    Promise.all(clips.map(clip => clip.play())).catch(() => {
      for (const clip of clips) clip.pause();
      status.textContent = '동시 재생에 실패했습니다. 각 영상에서 재생하세요.';
    });
  });
  panel.append(play, status, wrap);
  return panel;
}

function visualComparison(left, right) {
  const box = el('div', null, 'compare-visual');
  box.append(el('h4', right ? '프레임·영상 비교' : '프레임 관측'));
  const frames = frameBrowser(left, right);
  if (!right) {
    box.append(frames);
    return box;
  }

  const clips = videos(left, right);
  const controls = el('div', null, 'view-switch');
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', '실행 비교 보기');
  const frameButton = el('button', '프레임');
  const videoButton = el('button', '영상');
  frames.id = 'compare-frames';
  clips.id = 'compare-videos';
  for (const [button, panel] of [[frameButton, frames], [videoButton, clips]]) {
    button.type = 'button';
    button.setAttribute('aria-controls', panel.id);
    button.addEventListener('click', () => show(panel === frames));
  }
  function show(showFrames) {
    frames.hidden = !showFrames;
    clips.hidden = showFrames;
    frameButton.setAttribute('aria-pressed', String(showFrames));
    videoButton.setAttribute('aria-pressed', String(!showFrames));
    if (showFrames) clips.querySelectorAll('video').forEach(video => video.pause());
  }
  show(true);
  controls.append(frameButton, videoButton);
  box.append(controls, frames, clips);
  return box;
}

export async function mountComparison() {
  const status = document.getElementById('compare-status');
  const content = document.getElementById('compare-content');
  const selector = document.getElementById('run-selector');
  try {
    const [baseline, variant] = await Promise.all([read('data/run.json'), read('data/deepseek/run.json', true)]);
    const left = await experiment('data/', LUNA, baseline);
    let right = null;
    if (variant) {
      const sameFrames = baseline.frames.length === variant.frames.length &&
        baseline.frames.every((f, i) => f.name === variant.frames[i].name);
      if (variant.llm?.model !== EXACT_MODEL || baseline.llm?.model !== 'gpt-6-luna' || !sameFrames ||
          !baseline.accuracy?.reference_manifest_sha256 ||
          baseline.accuracy.reference_manifest_sha256 !== variant.accuracy?.reference_manifest_sha256) {
        status.textContent = 'DeepSeek 실행의 모델, 입력 프레임 또는 기준 자세가 달라 비교할 수 없습니다.';
      } else {
        right = await experiment('data/deepseek/', DEEPSEEK, variant).catch(() => null);
        if (!right) status.textContent = 'DeepSeek 실행의 비교 파일을 모두 읽지 못했습니다.';
      }
    } else {
      status.textContent = 'DeepSeek V4.1 Flash 실행 결과가 아직 없습니다.';
    }
    if (right && baseline.gpu && baseline.gpu === variant.gpu) {
      const gpu = baseline.gpu.replace(/^NVIDIA GeForce /, '');
      document.getElementById('results-scope').textContent =
        `두 실행은 ${gpu}에서 FunGraph3D 0kitchen/video0의 같은 RGB 프레임 ${baseline.frames_processed}장을 처리했습니다.`;
    }
    if (right) {
      selector.querySelectorAll('a')[1].hidden = false;
      status.hidden = true;
      document.getElementById('result-deepseek-fps').textContent = number(right.run.fps, 3);
      renderGraphRecall(right.run, DEEPSEEK);
      document.getElementById('result-deepseek-ate').textContent = number(right.run.accuracy?.ate_rmse_mm, 2);
      document.getElementById('result-deepseek-token-cost').textContent = usd(combinedUsage(right.summary, 'list_cost_usd'));
    }
    document.getElementById('result-token-cost').textContent = usd(combinedUsage(left.summary, 'list_cost_usd'));
    const rows = fields => fields.map(([label, readValue, digits]) => {
      const format = x => {
        const value = readValue(x);
        return typeof value === 'string' ? value : number(value, digits);
      };
      return [label, format(left), right ? format(right) : '—'];
    });
    const timing = right?.run.llm?.cache_mode === 'reused'
      ? 'DeepSeek는 이전 응답을 재사용했습니다. 표의 FPS는 캐시 준비 시간을 제외합니다.'
      : '';
    const lunaTiming = baseline.llm?.cache_mode === 'cold' ? 'Luna는 빈 캐시로 실행했습니다.' : '';
    document.getElementById('timing-context').textContent = [lunaTiming, timing].filter(Boolean).join(' ');
    const method = el('p', timing
      ? 'DeepSeek의 캐시는 GPU 메모리 부족으로 중단된 실행에서 가져왔습니다. FPS에는 SAM3 마스크 저장 시간이 포함됩니다.'
      : 'FPS에는 API 응답 대기와 SAM3 마스크 저장 시간이 포함됩니다.', 'project-caption');
    const graphLink = el('a', '3D 그래프에서 보기', 'compare-graph-link');
    graphLink.href = '#run';
    content.append(
      table('그래프 출력', rows(graphFields)),
      el('p', '노드와 연결은 시스템이 추정한 결과입니다. 실제 조작 성공 여부는 평가하지 않았습니다.', 'project-caption'),
      graphLink,
      visualComparison(left, right),
    );
    document.getElementById('comparison-details').append(
      disclosure('실행 성능과 자세 오차', table('실행 지표', rows(performanceFields)), method),
      disclosure('인식·그래프·루프·API 집계', table('집계 지표', rows(detailFields))),
      disclosure('SAM3 라벨별 검출 수', countsTable('라벨', new Map(Object.entries(left.summary.sam3.labels)), right && new Map(Object.entries(right.summary.sam3.labels)))),
      disclosure('장면 사전과 3D 그래프 비교',
        el('p', '실행마다 노드 ID가 달라 역할, 라벨, 관계 문구로 집계합니다.', 'project-caption'),
        countsTable('장면 사전 물체', tally(left.inference.atlas_objects), right && tally(right.inference.atlas_objects)),
        countsTable('장면 사전 O/C/U 관계', localTargets(left.inference.objects, left.inference.atlas_objects),
          right && localTargets(right.inference.objects, right.inference.atlas_objects)),
        countsTable('장면 사전 원격 관계', tally(left.inference.atlas_remote.map(r => r.join(' · '))), right && tally(right.inference.atlas_remote.map(r => r.join(' · ')))),
        countsTable('3D 노드', nodeLabels(left.graph), right && nodeLabels(right.graph)),
        countsTable('확정 3D 관계', relations(left.graph), right && relations(right.graph))),
    );
  } catch {
    status.textContent = '비교 데이터를 불러오지 못했습니다. 잠시 후 페이지를 새로고침해 주세요.';
  }
}
