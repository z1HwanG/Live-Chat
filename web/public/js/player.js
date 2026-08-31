// 播放器：自适应 WebRTC(超低延迟) -> FLV(低延迟) -> HLS(高兼容) 自动回退
window.LivePlayer = (function () {
  const video = document.getElementById('video');
  const statusEl = document.getElementById('playerStatus');

  let stream = 'stream';
  let mode = 'auto';
  let active = null; // 当前生效方式
  let failed = false;
  let pc = null;
  let flvPlayer = null;
  let hlsPlayer = null;
  let heartTimer = null;

  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = 'player-status ' + (kind || '');
  }

  function stopAll() {
    if (pc) { try { pc.close(); } catch (e) {} pc = null; }
    if (flvPlayer) { try { flvPlayer.destroy(); } catch (e) {} flvPlayer = null; }
    if (hlsPlayer) { try { hlsPlayer.destroy(); } catch (e) {} hlsPlayer = null; }
    if (video.srcObject) { video.srcObject = null; }
    video.removeAttribute('src');
    video.onerror = null;
    active = null;
  }

  // ---------- WebRTC（SRS 信令 POST /rtc/v1/play/） ----------
  function playWebRTC() {
    return new Promise((resolve, reject) => {
      if (typeof RTCPeerConnection === 'undefined') {
        return reject(new Error('浏览器不支持 WebRTC'));
      }
      stopAll();
      let settled = false;
      const finish = (ok, err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (ok) { active = 'webrtc'; setStatus('超低延迟 · WebRTC', 'ok'); resolve(); }
        else reject(err || new Error('WebRTC 失败'));
      };
      const timer = setTimeout(() => finish(false, new Error('WebRTC 连接超时')), 12000);
      try {
        pc = new RTCPeerConnection({ iceServers: [] });
        pc.addTransceiver('video', { direction: 'recvonly' });
        pc.addTransceiver('audio', { direction: 'recvonly' });
        pc.ontrack = (e) => {
          video.srcObject = e.streams[0];
          video.play().catch(() => {});
          finish(true);
        };
        pc.onconnectionstatechange = () => {
          const st = pc && pc.connectionState;
          if (st === 'failed' || st === 'disconnected') finish(false, new Error('WebRTC 连接中断'));
        };
        pc.createOffer()
          .then((o) => pc.setLocalDescription(o))
          .then(() =>
            fetch('/rtc/v1/play/', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                api: location.origin + '/rtc/v1/play/',
                streamurl: 'webrtc://' + location.host + '/live/' + stream,
                clientip: '',
                sdp: pc.localDescription.sdp
              })
            })
          )
          .then((r) => r.json())
          .then((d) => {
            if (!d || d.code !== 0) throw new Error('信令错误 code=' + (d && d.code));
            return pc.setRemoteDescription({ type: 'answer', sdp: d.sdp });
          })
          .catch((err) => finish(false, err));
      } catch (err) {
        finish(false, err);
      }
    });
  }

  // ---------- HTTP-FLV（mpegts.js） ----------
  function playFLV() {
    return new Promise((resolve, reject) => {
      if (typeof mpegts === 'undefined' || !mpegts.isSupported()) {
        return reject(new Error('浏览器不支持 FLV'));
      }
      stopAll();
      let settled = false;
      const finish = (ok, err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (ok) { active = 'flv'; setStatus('低延迟 · FLV', 'ok'); resolve(); }
        else { try { flvPlayer && flvPlayer.destroy(); } catch (e) {} flvPlayer = null; reject(err || new Error('FLV 失败')); }
      };
      const timer = setTimeout(() => finish(false, new Error('FLV 播放超时')), 15000);
      try {
        flvPlayer = mpegts.createPlayer(
          { type: 'flv', isLive: true, url: '/live/' + stream + '.flv' },
          {
            liveBufferLatencyChasing: true,
            liveBufferLatencyMaxLatency: 2.0,
            liveBufferLatencyMinRemain: 0.5
          }
        );
        flvPlayer.attachMediaElement(video);
        flvPlayer.on(mpegts.Events.ERROR, () => finish(false, new Error('FLV 播放错误')));
        flvPlayer.load();
        const p = flvPlayer.play();
        if (p && p.then) p.then(() => finish(true)).catch((e) => finish(false, e));
        else setTimeout(() => finish(true), 1000);
      } catch (err) {
        finish(false, err);
      }
    });
  }

  // ---------- HLS（Safari 原生 / hls.js） ----------
  function playHLS() {
    return new Promise((resolve, reject) => {
      stopAll();
      const url = '/live/' + stream + '.m3u8';
      let settled = false;
      const finish = (ok, err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (ok) { active = 'hls'; setStatus('兼容 · HLS', 'ok'); resolve(); }
        else reject(err || new Error('HLS 失败'));
      };
      const timer = setTimeout(() => finish(false, new Error('HLS 播放超时')), 15000);
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url;
        video.onerror = () => finish(false, new Error('HLS 原生播放失败'));
        video.play().then(() => finish(true)).catch(() => finish(false, new Error('HLS 无法播放')));
      } else if (typeof Hls !== 'undefined' && Hls.isSupported()) {
        hlsPlayer = new Hls({ lowLatencyMode: true });
        hlsPlayer.loadSource(url);
        hlsPlayer.attachMedia(video);
        hlsPlayer.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().then(() => finish(true)).catch(() => finish(false, new Error('HLS 无法播放')));
        });
        hlsPlayer.on(Hls.Events.ERROR, (e, data) => {
          if (data && data.fatal) finish(false, new Error('HLS 播放错误'));
        });
      } else {
        finish(false, new Error('浏览器不支持 HLS'));
      }
    });
  }

  const PLAYERS = { webrtc: playWebRTC, flv: playFLV, hls: playHLS };

  function candidates() {
    if (mode === 'webrtc') return ['webrtc'];
    if (mode === 'flv') return isIOS ? ['hls'] : ['flv', 'hls'];
    if (mode === 'hls') return ['hls'];
    // auto：
    //   非 iOS：默认 FLV（AAC 直出不转码，音质好、延迟 1~2s）
    //   iOS：默认 HLS（Safari 原生）
    //   WebRTC 需 SRS 做 AAC->Opus 转码（音质有限），保留为手动"超低延迟"选项
    return isIOS ? ['hls', 'webrtc'] : ['flv', 'hls', 'webrtc'];
  }

  async function start() {
    failed = false;
    stopAll();
    setStatus('连接中…', '');
    const cs = candidates();
    for (let i = 0; i < cs.length; i++) {
      try {
        await PLAYERS[cs[i]]();
        return;
      } catch (err) {
        console.warn('[player] 播放方式失败:', cs[i], err && err.message);
        if (i < cs.length - 1) setStatus('切换播放方式…', 'warn');
      }
    }
    failed = true;
    setStatus('无法播放：请确认主播已开播', 'err');
  }

  function init(streamName) {
    stream = streamName || 'stream';
    startHeartbeat();
    document.querySelectorAll('.mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        mode = btn.dataset.mode;
        document.querySelectorAll('.mode-btn').forEach((b) =>
          b.classList.toggle('active', b === btn)
        );
        start();
      });
    });
    start();
  }

  function startHeartbeat() {
    if (heartTimer) clearInterval(heartTimer);
    heartTimer = setInterval(() => {
      fetch('/api/heartbeat', { method: 'POST' }).catch(() => {});
    }, 15000);
    fetch('/api/heartbeat', { method: 'POST' }).catch(() => {});
  }

  return { init, start, isFailed: () => failed, activeMode: () => active };
})();
