const video = document.getElementById('demo-video');
const videoStatus = document.getElementById('demo-status');

function describeVideoError() {
  videoStatus.textContent = '데모 영상을 불러오지 못했습니다. 표시된 이미지는 실행에 사용한 입력 프레임입니다.';
}

video.addEventListener('error', describeVideoError);
video.addEventListener('loadedmetadata', () => { videoStatus.textContent = ''; });
if (video.error) describeVideoError();

const copyButton = document.getElementById('copy-bibtex');
const citation = document.getElementById('bibtex-entry');
const copyStatus = document.getElementById('copy-status');
copyButton.hidden = false;

copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(citation.textContent);
    copyStatus.textContent = 'BibTeX를 복사했습니다.';
  } catch {
    const selection = window.getSelection();
    citation.parentElement.focus();
    const range = document.createRange();
    range.selectNodeContents(citation);
    selection.removeAllRanges();
    selection.addRange(range);
    copyStatus.textContent = document.execCommand('copy')
      ? 'BibTeX를 복사했습니다.'
      : 'BibTeX를 선택했습니다. 브라우저의 복사 단축키를 눌러 주세요.';
  }
});

export function renderResults(run) {
  const metric = (id, value, digits) => {
    document.getElementById(id).textContent = Number.isFinite(value) ? value.toFixed(digits) : '미측정';
  };
  metric('result-fps', run.fps, 3);
  metric('result-recall', run.accuracy?.node_recall_at_3, 2);
  if (!Number.isFinite(run.accuracy?.node_recall_at_3)) {
    document.getElementById('result-recall').textContent = '미측정 · 이 영상 구간의 평가 대상 미확정';
  }
  metric('result-ate', run.accuracy?.ate_rmse_mm, 2);
  const accuracy = run.accuracy;
  if (Number.isFinite(accuracy?.sim3?.ate_rmse_mm) && Number.isFinite(accuracy?.se3?.ate_rmse_mm)) {
    document.getElementById('accuracy-context').textContent =
      `ATE는 원본 FunGraph3D의 COLMAP 기준 자세와 일치하는 키프레임 ${accuracy.matched_keyframes}개에서 계산했습니다. `
      + `표의 값은 스케일을 맞춘 Sim(3) 오차입니다. 스케일을 고정한 SE(3) 오차는 ${accuracy.se3.ate_rmse_mm.toFixed(2)} mm입니다. `
      + '논문은 정렬 옵션을 명시하지 않았습니다.';
  }

  const runContext = [run.gpu, run.llm?.model].filter(Boolean);
  if (run.llm?.cache_mode === 'cold') {
    runContext.push('빈 언어 모델 캐시에서 시작');
  } else if (!run.llm?.cache_mode && run.llm?.substitute && /^Qwen2\.5-7B-Instruct/.test(run.llm.model)) {
    runContext.push('준비된 언어 모델 캐시 재사용 · 캐시 생성 시간 제외');
  }
  if (run.command?.includes('--sam3-save-vis')) runContext.push('FPS에 마스크 저장 시간 포함');
  document.getElementById('results-context').textContent = runContext.join(' / ');
}
