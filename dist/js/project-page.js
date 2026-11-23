import {mountComparison} from './comparison.js?v=2';

const viewerOnly = new URLSearchParams(location.search).get('view') === '3d';
if (viewerOnly) document.body.classList.add('viewer-only');
else mountComparison();

const video = document.getElementById('demo-video');
const videoStatus = document.getElementById('demo-status');

function describeVideoError() {
  videoStatus.textContent = '영상을 불러오지 못했습니다. 화면의 사진은 실행에 사용한 입력 프레임입니다.';
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
  metric('result-ate', run.accuracy?.ate_rmse_mm, 2);
  const accuracy = run.accuracy;
  if (Number.isFinite(accuracy?.sim3?.ate_rmse_mm)) {
    document.getElementById('accuracy-context').textContent =
      `재현 ATE는 키프레임 ${accuracy.matched_keyframes}개의 COLMAP 기준 자세에 스케일까지 맞춘 Sim(3) 오차입니다. `
      + '논문은 정렬 방식을 명시하지 않았습니다.';
  }
}
