const listView = document.getElementById('listView');
const playerView = document.getElementById('playerView');
const liveList = document.getElementById('liveList');
const listStatus = document.getElementById('listStatus');
const video = document.getElementById('video');
const playerStatus = document.getElementById('playerStatus');

let hls = null;
let currentChannel = null; // 현재 보고 있는 채널 (목록이면 null)

function fmt(n) {
  if (typeof n !== 'number') return '0';
  return n.toLocaleString('ko-KR');
}

function showList() {
  stopPlayback();
  currentChannel = null;
  window.api.clearLastChannel(); // 목록으로 돌아가면 복원 대상 해제
  playerView.hidden = true;
  listView.hidden = false;
  window.api.setView('list');
  loadLives();
}

function stopPlayback() {
  try {
    video.pause();
    video.removeAttribute('src');
    video.load();
  } catch (e) { /* 무시 */ }
  if (hls) { hls.destroy(); hls = null; }
}

async function loadLives() {
  listStatus.hidden = false;
  listStatus.textContent = '불러오는 중…';
  liveList.innerHTML = '';
  try {
    const lives = await window.api.getLives();
    if (!lives.length) { listStatus.textContent = '진행 중인 방송이 없습니다.'; return; }
    listStatus.hidden = true;
    for (const l of lives) {
      const li = document.createElement('li');
      const img = document.createElement('img');
      if (l.thumbnail) img.src = l.thumbnail;
      const text = document.createElement('div');
      text.className = 'li-text';
      const t1 = document.createElement('div');
      t1.className = 'li-title';
      t1.textContent = l.title || '(제목 없음)';
      const t2 = document.createElement('div');
      t2.className = 'li-sub';
      t2.innerHTML = `<span class="li-viewers">● ${fmt(l.viewers)}</span> · ${l.channelName || ''}`;
      text.appendChild(t1);
      text.appendChild(t2);
      li.appendChild(img);
      li.appendChild(text);
      li.addEventListener('click', () => playChannel(l));
      liveList.appendChild(li);
    }
  } catch (e) {
    listStatus.hidden = false;
    listStatus.textContent = '목록을 불러오지 못했습니다.';
  }
}

async function playChannel(live) {
  currentChannel = {
    channelId: live.channelId,
    channelName: live.channelName,
    title: live.title,
    thumbnail: live.thumbnail,
  };
  window.api.setLastChannel(currentChannel); // 종료 후 재실행 시 복원용으로 저장
  listView.hidden = true;
  playerView.hidden = false;
  window.api.setView('player');
  playerStatus.hidden = false;
  playerStatus.textContent = '연결 중…';
  try {
    const { url } = await window.api.getStream(live.channelId);
    startHls(url);
  } catch (e) {
    playerStatus.hidden = false;
    playerStatus.textContent = e.message || '재생할 수 없습니다.';
  }
}

function startHls(url) {
  stopPlayback();
  if (window.Hls && window.Hls.isSupported()) {
    hls = new window.Hls({ liveSyncDurationCount: 3, lowLatencyMode: true });
    hls.loadSource(url);
    hls.attachMedia(video);
    hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
      playerStatus.hidden = true;
      video.play().catch(() => {});
    });
    hls.on(window.Hls.Events.ERROR, (_e, data) => {
      if (data.fatal) {
        playerStatus.hidden = false;
        playerStatus.textContent = '스트림 오류가 발생했습니다.';
      }
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    // macOS Safari/WebKit 네이티브 HLS
    video.src = url;
    video.addEventListener('loadedmetadata', () => { playerStatus.hidden = true; video.play().catch(() => {}); }, { once: true });
  } else {
    playerStatus.hidden = false;
    playerStatus.textContent = 'HLS 재생을 지원하지 않습니다.';
  }
}

// ── 카메라 모션 감지: 움직임이 보이면 창 자동 숨김 ──
let camActive = false;
let camStream = null;
let motionTimer = null;
let prevData = null;
let motionStartedAt = 0;
let motionHits = 0;
let windowVisible = false;       // 창이 현재 보이는지
let motionEnabled = true;        // 움직임 감지 사용 여부 (옵션 창에서 변경)
let motionRatio = 0.325;         // 감지 임계값 (민감도 슬라이더로 변경)
const camVideo = document.createElement('video');
camVideo.muted = true;
camVideo.playsInline = true;
const mCanvas = document.createElement('canvas');
mCanvas.width = 64;
mCanvas.height = 36;
const mCtx = mCanvas.getContext('2d', { willReadFrequently: true });

const MOTION_PIXEL_DIFF = 50;   // 픽셀 밝기 변화 임계값
const MOTION_GRACE_MS = 3000;   // 창이 뜬 직후 오탐 방지 유예시간(3초)
const MOTION_CONSECUTIVE = 3;   // 연속 3회 감지 시 동작(노이즈 억제)

// 민감도(0~100) → 임계 비율. 높을수록 민감(작은 움직임에도 반응 = 낮은 비율).
function sensitivityToRatio(s) {
  const minRatio = 0.05; // 가장 민감
  const maxRatio = 0.60; // 가장 둔감
  const clamped = Math.max(0, Math.min(100, s));
  return maxRatio - (clamped / 100) * (maxRatio - minRatio);
}

function applySettings(s) {
  motionEnabled = s.motionEnabled;
  motionRatio = sensitivityToRatio(s.motionSensitivity);
  if (motionEnabled && windowVisible) startMotionDetection();
  else if (!motionEnabled) stopMotionDetection();
}

async function startMotionDetection() {
  if (camActive) return; // 중복 시작 방지(동기 가드)
  camActive = true;
  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 320, height: 240 }, audio: false,
    });
    if (!camActive) { // 시작 도중 다시 숨겨진 경우 정리
      camStream.getTracks().forEach((t) => t.stop());
      camStream = null;
      return;
    }
    camVideo.srcObject = camStream;
    await camVideo.play();
    prevData = null;
    motionHits = 0;
    motionStartedAt = performance.now();
    motionTimer = setInterval(checkMotion, 150); // 약 6~7fps
  } catch (e) {
    camActive = false;
    console.log('camera err: ' + e); // 카메라 없음/권한 거부 시 무시(기능만 비활성)
  }
}

function stopMotionDetection() {
  camActive = false;
  if (motionTimer) { clearInterval(motionTimer); motionTimer = null; }
  if (camStream) { camStream.getTracks().forEach((t) => t.stop()); camStream = null; }
  camVideo.srcObject = null;
  prevData = null;
  motionHits = 0;
}

function checkMotion() {
  if (camVideo.readyState < 2) return;
  mCtx.drawImage(camVideo, 0, 0, mCanvas.width, mCanvas.height);
  const cur = mCtx.getImageData(0, 0, mCanvas.width, mCanvas.height).data;
  if (prevData) {
    let changed = 0;
    const total = mCanvas.width * mCanvas.height;
    for (let i = 0; i < cur.length; i += 4) {
      const d = Math.abs(cur[i] - prevData[i])
        + Math.abs(cur[i + 1] - prevData[i + 1])
        + Math.abs(cur[i + 2] - prevData[i + 2]);
      if (d > MOTION_PIXEL_DIFF) changed++;
    }
    const ratio = changed / total;
    if (performance.now() - motionStartedAt > MOTION_GRACE_MS && ratio > motionRatio) {
      motionHits++;
      if (motionHits >= MOTION_CONSECUTIVE) {
        stopMotionDetection();
        window.api.hide(); // 움직임 감지 → 창 숨김 (다시 켜기: Ctrl+0)
        return;
      }
    } else {
      motionHits = 0;
    }
  }
  prevData = cur;
}

// ── 화면 드래그로 창 이동 (목록 항목 클릭은 제외) ──
let dragging = false;
let dragSX = 0;
let dragSY = 0;
document.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;                 // 좌클릭만
  if (e.target.closest('#liveList li')) return; // 목록 항목은 선택용
  dragging = true;
  dragSX = e.screenX;
  dragSY = e.screenY;
  window.api.dragStart();
  try { e.target.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
});
document.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  window.api.dragMove(e.screenX - dragSX, e.screenY - dragSY);
});
document.addEventListener('pointerup', () => {
  if (!dragging) return;
  dragging = false;
  window.api.dragEnd();
});

// ── 이벤트 ──
// 우클릭 메뉴(메인 프로세스)에서 "뒤로가기" 선택 시
window.api.onGoBack(() => showList());

// 목록 화면에서만 새로고침 (재생 중에는 무시)
function refreshList() {
  if (!listView.hidden) loadLives();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.api.hide();
  if (e.key === 'F5') { e.preventDefault(); refreshList(); }
});

// 우클릭 메뉴(메인 프로세스)에서 "목록 새로고침" 선택 시
window.api.onRefreshList(() => refreshList());

// 창이 숨겨지면 재생 중단 + 카메라 끔. 보던 채널은 currentChannel 에 보존됨.
window.api.onHidden(() => {
  windowVisible = false;
  stopPlayback();
  stopMotionDetection();
});

// 창이 열리면: 보던 채널이 있으면 그 채널을 다시 재생, 없으면 목록 표시. 그리고 모션 감지 시작.
window.api.onShown(() => {
  windowVisible = true;
  if (currentChannel) playChannel(currentChannel);
  else showList();
  if (motionEnabled) startMotionDetection();
});

// 옵션 창에서 설정 변경 시 실시간 반영
window.api.onSettingsChanged((s) => applySettings(s));

// 시작 시 현재 설정값 로드
window.api.getSettings().then((s) => applySettings(s));

// 시작 시 마지막으로 보던 채널을 복원 대상으로 불러옴 (실제 재생은 창이 열릴 때)
window.api.getLastChannel().then((last) => {
  if (last && last.channelId) currentChannel = last;
});
