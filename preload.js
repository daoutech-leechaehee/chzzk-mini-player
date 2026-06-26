const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getLives: () => ipcRenderer.invoke('get-lives'),
  getStream: (channelId) => ipcRenderer.invoke('get-stream', channelId),
  hide: () => ipcRenderer.send('hide-window'),
  setView: (view) => ipcRenderer.send('set-view', view),
  onGoBack: (cb) => ipcRenderer.on('go-back', cb),
  onRefreshList: (cb) => ipcRenderer.on('refresh-list', cb),
  // 수동 창 드래그
  dragStart: () => ipcRenderer.send('drag-start'),
  dragMove: (dx, dy) => ipcRenderer.send('drag-move', dx, dy),
  dragEnd: () => ipcRenderer.send('drag-end'),
  // 마지막으로 보던 채널 저장/조회/해제 (종료 후 재실행 복원용)
  getLastChannel: () => ipcRenderer.invoke('get-last-channel'),
  setLastChannel: (ch) => ipcRenderer.send('set-last-channel', ch),
  clearLastChannel: () => ipcRenderer.send('clear-last-channel'),
  // 창 표시/숨김 이벤트
  onShown: (cb) => ipcRenderer.on('window-shown', cb),
  onHidden: (cb) => ipcRenderer.on('window-hidden', cb),
  // 설정 (옵션 창에서 읽기/쓰기, 플레이어 창에서 변경 수신)
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (patch) => ipcRenderer.send('set-settings', patch),
  onSettingsChanged: (cb) => ipcRenderer.on('settings-changed', (_e, s) => cb(s)),
});
