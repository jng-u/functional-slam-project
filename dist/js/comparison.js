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

const fields = [
  ['처리한 프레임', x => x.run.frames_processed],
  ['실행 시간 (초)', x => x.summary.wall_seconds, 1],
  ['처리 속도 (FPS)', x => x.run.fps, 3],
  ['시작할 때 LLM 캐시', x => ({cold: '비어 있음', reused: '이전 실행 응답 재사용'})[x.run.llm?.cache_mode]],
  ['모델 추론 설정', x => ({low: '낮음 (low)', none: '끄기 (none)'})[x.run.llm?.reasoning_effort]],
  ['GPU', x => x.run.gpu],
  ['키프레임', x => x.run.keyframes],
  ['내보낸 점군의 점', x => x.run.map.count],
  ['기준 자세와 일치한 키프레임', x => x.run.accuracy?.matched_keyframes],
  ['ATE RMSE · Sim(3) (mm)', x => x.run.accuracy?.sim3?.ate_rmse_mm, 2],
  ['ATE RMSE · SE(3) (mm)', x => x.run.accuracy?.se3?.ate_rmse_mm, 2],
  ['Sim(3) 정렬 스케일', x => x.run.accuracy?.sim3?.scale, 4],
  ['노드 Recall@3 (%)', x => x.run.accuracy?.node_recall_at_3, 2],
  ['장면 분류', x => x.inference.scene?.scene_type],
  ['장면 분류 신뢰도', x => x.inference.scene?.confidence, 2],
  ['장면을 확정한 프레임', x => {
    const i = x.inference.scene?.locked_at_frame;
    return Number.isInteger(i) && i >= 0 ? i + 1 : null;
  }],
  ['장면 사전의 물체', x => x.inference.atlas_objects.length],
  ['장면 사전의 원격 관계 후보', x => x.inference.atlas_remote.length],
  ['프레임 태그에서 추가한 대상 종류', x => Object.keys(x.inference.first_frame).length],
  ['서로 다른 로컬 캐시 응답', x => x.inference.llm_calls],
  ['SAM3 해상도 설정', x => x.summary.sam3.resolution],
  ['SAM3 검출이 있는 프레임', x => x.summary.sam3.frames_with_detections],
  ['SAM3 검출 합계', x => x.summary.sam3.detections],
  ['추적한 3D 노드', x => x.graph.summary.tracked_nodes],
  ['위치가 있는 노드', x => x.graph.summary.posed_nodes],
  ['위치가 없는 노드', x => x.graph.summary.unposed_nodes],
  ['내보내기에서 숨긴 노드', x => x.graph.summary.hidden_nodes],
  ...[['O', '물체'], ['C', '중간 부품'], ['U', '조작 부위']].map(([role, label]) =>
    [label + ' (' + role + ') · 추적 / 3D 표시', x => {
      const {total_role_counts: total, posed_role_counts: posed} = x.graph.summary;
      return number(total?.[role]) + ' / ' + number(posed?.[role]);
    }]),
  ...['local', 'remote'].flatMap(kind => {
    const label = kind === 'local' ? '로컬' : '원격';
    return [
      [label + ' 연결 · 3D 표시', x => x.graph.edges.filter(e => e.kind === kind).length],
      [label + ' 연결 · 확정', x => x.graph.summary.edge_status_counts[kind + '_committed'] ?? 0],
      [label + ' 연결 · 잠정', x => x.graph.summary.edge_status_counts[kind + '_tentative'] ?? 0],
    ];
  }),
  ['루프 검색 횟수', x => x.run.loops?.events.length],
  ['영상 검색 후보', x => x.run.loops?.visual_candidates],
  ['기능 그래프가 보탠 루프 후보', x => x.run.loops?.functional_proposed],
  ['기하 검증을 통과한 추가 후보', x => x.run.loops?.functional_accepted],
  ['기능으로 보강한 기존 후보', x => x.run.loops?.functional_strengthened],
  ['이 실행의 새 LLM 응답', x => x.summary.api_usage?.successful_responses],
  ['새 응답의 입력 토큰', x => x.summary.api_usage?.prompt_tokens],
  ['새 응답의 출력 토큰', x => x.summary.api_usage?.completion_tokens],
  ['새 응답의 전체 토큰', x => x.summary.api_usage?.total_tokens],
  ['캐시를 준비한 이전 요청의 응답 수', x => x.summary.reused_api_usage?.successful_responses],
  ['캐시를 준비한 이전 요청의 토큰', x => x.summary.reused_api_usage?.total_tokens],
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

function runURL(x, frame = null, view = null) {
  const url = new URL('./', location.href);
  if (x.base !== 'data/') url.searchParams.set('run', 'deepseek');
  if (frame !== null) url.searchParams.set('frame', String(frame));
  if (view) url.searchParams.set('view', view);
  url.hash = 'run';
  return url;
}

function runLink(x, frame = null) {
  const a = el('a', frame === null ? x.name + ' 3D 그래프 열기' : '이 프레임의 전체 관측 열기');
  a.href = runURL(x, frame).href;
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
  const label = el('label', '입력 프레임 ');
  const slider = el('input');
  slider.type = 'range';
  slider.min = 0;
  slider.max = frames.length - 1;
  slider.value = initial;
  label.append(slider);
  const frameName = el('output');
  const controls = el('div', null, 'compare-frame-controls');
  controls.append(label, frameName);
  const announce = () => {
    const i = Number(slider.value);
    frameName.textContent = i + 1 + ' / ' + frames.length + ' · ' + frames[i].name;
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
  const images = el('div', null, 'compare-media');
  const info = el('div');
  const local = el('div');
  box.append(controls, photoToggle, images, info, disclosure('이 프레임의 O/C/U 관계 문구', local));

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
      const caption = el('figcaption', img.alt, 'project-caption');
      fig.append(img, caption, runLink(x, i));
      images.append(fig);
    }
    const list = values => values?.join(', ') || '없음';
    const frameFields = [
      ['RAM++ 태그', x => list(x.inference.frames[i]?.tags)],
      ['SAM3에 넘긴 탐색 대상', x => list(x.inference.frames[i]?.targets)],
      ['이 프레임에서 추가된 대상', x => list(x.inference.frames[i]?.added)],
      ['원격 관계 후보', x => list(x.inference.frames[i]?.remote?.map(([a, b, text]) => a + ' → ' + b + (text ? ' · ' + text : '')))],
      ['SAM3 검출 · 라벨별 수', x => {
        const counts = x.summary.sam3.by_frame?.[i];
        return counts ? list(Object.entries(counts).map(([k, n]) => k + ' ' + n)) : '미측정';
      }],
      ['키프레임 위치 오차 · Sim(3) (mm)', x => {
        const value = x.run.accuracy?.per_keyframe?.find(k => k.image === filename)?.translation_error_mm;
        return Number.isFinite(value) ? number(value, 2) : '기록 없음';
      }],
      ['루프 후보와 검증 결과', x => loopCandidates(x, i)],
    ];
    info.replaceChildren(table('프레임별 결과', frameFields.map(([key, value]) => [key, value(left), right ? value(right) : '—'])));
    const targets = x => localTargets(x.inference.objects, x.inference.frames[i]?.targets ?? []);
    local.replaceChildren(countsTable('탐색 관계 후보', targets(left), right && targets(right)));
  };
  slider.addEventListener('input', paint);
  photo.addEventListener('change', paint);
  paint();
  return box;
}

function videos(left, right) {
  const wrap = el('div', null, 'compare-media');
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
      status.textContent = '두 영상을 함께 재생하지 못했습니다. 각 영상의 재생 버튼을 사용해 보세요.';
    });
  });
  return disclosure('실행 영상 두 편 보기', play, status, wrap);
}

function pairedViewers(left, right) {
  const wrap = el('div', null, 'compare-media compare-map');
  const frames = left.run.frames;
  const {slider, controls} = frameControl(frames, frames.length - 1);
  const panes = new Map();
  const search = el('form', null, 'compare-search');
  search.setAttribute('role', 'search');
  const queryLabel = el('label', '두 지도에서 기능 찾기');
  const query = el('input');
  query.type = 'search';
  query.placeholder = '예: 물 틀어줘';
  query.maxLength = 500;
  query.required = true;
  queryLabel.append(query);
  const submit = el('button', '두 지도에 검색');
  submit.type = 'submit';
  submit.disabled = true;
  search.append(queryLabel, submit);
  const queryForms = () => Array.from(panes.values(), pane => pane.contentDocument?.querySelector('.graph-query-form'));
  const updateSearch = () => { submit.disabled = queryForms().filter(Boolean).length !== 2; };
  search.addEventListener('submit', event => {
    event.preventDefault();
    if (!query.value.trim()) return;
    for (const form of queryForms().filter(Boolean)) {
      form.querySelector('input[type=search]').value = query.value;
      form.requestSubmit();
    }
  });
  function seek(x, iframe) {
    const timeline = iframe.contentDocument?.getElementById('timeline');
    if (!timeline || timeline.hidden) return;
    const input = timeline.querySelector('input');
    const frame = Number(slider.value);
    const step = x.run.trajectory.findLast(k => k.frame <= frame)?.kf ?? 0;
    input.value = frame === frames.length - 1 ? input.max : step;
    input.dispatchEvent(new iframe.contentWindow.Event('input'));
  }
  slider.addEventListener('input', () => {
    for (const [x, iframe] of panes) seek(x, iframe);
  });
  const detail = disclosure('3D 점군·카메라 경로·기능 그래프 나란히 열기',
    el('p', '위치는 각 실행의 최종 좌표를 사용합니다. 공통 프레임을 고르면 해당 시점까지의 노드와 확정 관계를 두 지도에 표시합니다.', 'project-caption'),
    controls, search, wrap);
  detail.addEventListener('toggle', () => {
    wrap.replaceChildren();
    panes.clear();
    updateSearch();
    if (!detail.open) return;
    for (const x of [left, right]) {
      const figure = el('figure');
      const iframe = el('iframe');
      iframe.title = x.name + ' 3D 그래프';
      iframe.src = runURL(x, null, '3d').href;
      iframe.addEventListener('load', () => {
        const ready = () => { seek(x, iframe); updateSearch(); };
        iframe.contentDocument?.addEventListener('fslam:viewer-ready', ready, {once: true});
        ready();
      });
      panes.set(x, iframe);
      figure.append(el('figcaption', x.name, 'project-caption'), iframe);
      wrap.append(figure);
    }
  });
  return detail;
}

export async function mountComparison() {
  const status = document.getElementById('compare-status');
  const content = document.getElementById('compare-content');
  const selector = document.getElementById('run-selector');
  const selectedRun = new URLSearchParams(location.search).get('run');
  selector.querySelectorAll('a')[selectedRun === 'deepseek' ? 1 : 0].setAttribute('aria-current', 'true');
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
    if (right) {
      selector.querySelectorAll('a')[1].hidden = false;
      status.hidden = true;
      const links = el('div', null, 'run-selector');
      links.append(runLink(left), runLink(right));
      content.append(links);
      document.getElementById('result-deepseek-fps').textContent = number(right.run.fps, 3);
      document.getElementById('result-deepseek-recall').textContent = number(right.run.accuracy?.node_recall_at_3, 2);
      document.getElementById('result-deepseek-ate').textContent = number(right.run.accuracy?.ate_rmse_mm, 2);
      if (selectedRun === 'deepseek') {
        const video = document.getElementById('demo-video');
        video.poster = imageURL(right, right.run.frames[37].url);
        video.src = right.base + 'demo.mp4';
        video.setAttribute('aria-label', DEEPSEEK + ' 실행 데모');
        document.getElementById('demo-caption').textContent = DEEPSEEK + ' · FunGraph3D 0kitchen/video0';
      }
    }
    const rows = fields.map(([label, readValue, digits]) => {
      const format = x => {
        const value = readValue(x);
        return typeof value === 'string' ? value : number(value, digits);
      };
      return [label, format(left), right ? format(right) : '—'];
    });
    const timing = right?.run.llm?.cache_mode === 'reused'
      ? 'DeepSeek FPS는 GPU 메모리 부족으로 중단된 실행의 응답을 재사용한 값입니다. 캐시를 준비한 시간은 제외되므로 Luna와 모델 속도를 직접 비교할 수 없습니다. '
      : 'FPS에는 API 응답 대기와 SAM3 마스크 저장 시간이 포함됩니다. ';
    const method = el('p', timing + 'Recall은 이 시퀀스에서 평가하지 않았습니다. 노드·관계 건수는 시스템 출력이며 정답률을 뜻하지 않습니다.', 'project-caption');
    const performanceFields = 13;
    content.append(table('실행 성능과 자세 정확도', rows.slice(0, performanceFields)), method);
    if (right) content.append(videos(left, right), pairedViewers(left, right));
    content.append(
      disclosure('같은 프레임의 2D 관측·추론·루프 비교', frameBrowser(left, right)),
      disclosure('인식·그래프·루프·API 집계', table('집계 지표', rows.slice(performanceFields))),
      disclosure('SAM3 검출 라벨별 집계', countsTable('라벨', new Map(Object.entries(left.summary.sam3.labels)), right && new Map(Object.entries(right.summary.sam3.labels)))),
      disclosure('장면 사전과 3D 그래프 비교',
        el('p', '노드 ID는 실행마다 따로 부여됩니다. 아래 집계는 O/C/U 역할, 라벨, 관계 문구를 기준으로 읽으세요.', 'project-caption'),
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
