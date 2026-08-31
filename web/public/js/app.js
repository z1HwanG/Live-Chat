// 入口：加载配置、启动播放器与聊天、轮询直播状态（开播自动重连）
(function () {
  let wasLive = null;

  function toast(text) {
    const el = document.getElementById('toast');
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add('hidden'), 2200);
  }
  window.toast = toast;

  async function pollStatus() {
    try {
      const d = await (await fetch('/api/live/status')).json();
      const el = document.getElementById('streamStatus');
      if (d.live) {
        el.textContent = '直播中';
        el.className = 'status-pill on';
        // 从"未开播"变为"开播"且当前播放失败时自动重连
        if (wasLive === false && LivePlayer.isFailed()) LivePlayer.start();
      } else {
        el.textContent = '未开播';
        el.className = 'status-pill off';
      }
      wasLive = d.live;
    } catch (e) {}
  }

  async function boot() {
    try {
      const cfg = await (await fetch('/api/config')).json();
      document.getElementById('siteName').textContent = cfg.siteName;
      document.getElementById('streamTitle').textContent = cfg.siteName;
      document.title = cfg.siteName;
      window.LivePlayer.init(cfg.stream);
    } catch (e) {
      document.getElementById('playerStatus').textContent = '配置加载失败';
      console.error(e);
    }
    window.Chat.init();
    window.Admin.init();
    pollStatus();
    setInterval(pollStatus, 15000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
