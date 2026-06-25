const motionEnabledEl = document.getElementById('motionEnabled');
const sensitivityEl = document.getElementById('sensitivity');
const sensValEl = document.getElementById('sensVal');
const sensRow = document.getElementById('sensRow');

function reflectEnabled(enabled) {
  sensRow.classList.toggle('disabled', !enabled);
}

// 현재 설정 불러오기
window.api.getSettings().then((s) => {
  motionEnabledEl.checked = s.motionEnabled;
  sensitivityEl.value = s.motionSensitivity;
  sensValEl.textContent = s.motionSensitivity;
  reflectEnabled(s.motionEnabled);
});

// 체크박스 변경 → 즉시 저장/반영
motionEnabledEl.addEventListener('change', () => {
  const enabled = motionEnabledEl.checked;
  reflectEnabled(enabled);
  window.api.setSettings({ motionEnabled: enabled });
});

// 슬라이더 변경 → 즉시 저장/반영
sensitivityEl.addEventListener('input', () => {
  const v = parseInt(sensitivityEl.value, 10);
  sensValEl.textContent = v;
  window.api.setSettings({ motionSensitivity: v });
});
