// 聊天客户端：WebSocket 连接、历史消息、在线人数、管理员操作记录
window.Chat = (function () {
  let ws = null;
  let nick = localStorage.getItem('lc_nick') || '';
  let joined = false;

  const msgList = document.getElementById('msgList');
  const nickInput = document.getElementById('nickInput');
  const msgInput = document.getElementById('msgInput');
  const sendBtn = document.getElementById('sendBtn');
  const viewerCount = document.getElementById('viewerCount');
  const onlineCount = document.getElementById('onlineCount');
  const chatHint = document.getElementById('chatHint');

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(proto + '//' + location.host + '/ws');
    ws.onopen = () => { if (nick) join(nick); };
    ws.onmessage = (e) => { try { handle(JSON.parse(e.data)); } catch (err) {} };
    ws.onclose = () => { joined = false; setTimeout(connect, 3000); };
    ws.onerror = () => { try { ws.close(); } catch (e) {} };
  }

  function join(name) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'join', nickname: name }));
  }

  function sendRaw(obj) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  function handle(msg) {
    switch (msg.type) {
      case 'hello':
        joined = true;
        setNick(msg.nickname);
        renderHistory(msg.history);
        updateCount(msg.online, msg.viewers);
        break;
      case 'chat': addMsg(msg); break;
      case 'sys': addSys(msg.text, msg.time); break;
      case 'count': updateCount(msg.online, msg.viewers); break;
      case 'delete': removeMsg(msg.id); break;
      case 'online_list': if (window.Admin) Admin.renderList(msg.list || []); break;
      case 'adminlog': addSys(msg.text, Date.now(), true); break;
      case 'error': toast(msg.text); break;
    }
  }

  function setNick(n) {
    nick = n;
    localStorage.setItem('lc_nick', n);
    nickInput.value = n;
    nickInput.readOnly = true;
    msgInput.disabled = false;
    sendBtn.disabled = false;
    chatHint.textContent = '已加入：' + n;
  }

  function renderHistory(list) {
    msgList.innerHTML = '';
    (list || []).forEach((m) => addMsg(m));
  }

  function addMsg(m) {
    const li = document.createElement('li');
    li.dataset.id = m.id;
    const nickEl = document.createElement('span');
    nickEl.className = 'nick';
    nickEl.textContent = m.nickname + '：';
    const contentEl = document.createElement('span');
    contentEl.className = 'content';
    contentEl.textContent = m.content;
    li.appendChild(nickEl);
    li.appendChild(contentEl);
    if (window.Admin && Admin.isMode()) Admin.attachOps(li, m);
    msgList.appendChild(li);
    trimList();
    scrollBottom();
  }

  function addSys(text, time, isLog) {
    const li = document.createElement('li');
    li.className = isLog ? 'msg-sys msg-log' : 'msg-sys';
    const t = document.createElement('span');
    t.textContent = text;
    li.appendChild(t);
    msgList.appendChild(li);
    trimList();
    scrollBottom();
  }

  function removeMsg(id) {
    const li = msgList.querySelector('li[data-id="' + id + '"]');
    if (li) li.remove();
  }

  function trimList() {
    while (msgList.children.length > 300) msgList.removeChild(msgList.firstChild);
  }

  function scrollBottom() { msgList.scrollTop = msgList.scrollHeight; }

  function updateCount(o, v) {
    onlineCount.textContent = o || 0;
    viewerCount.textContent = v || 0;
  }

  // ---------- 事件 ----------
  nickInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const name = nickInput.value.trim().slice(0, 16);
      if (!name) return toast('请输入昵称');
      if (!joined) join(name);
    }
  });

  function sendMsg() {
    if (!joined) { toast('请先输入昵称并回车加入'); return; }
    const content = msgInput.value.trim();
    if (!content) return;
    sendRaw({ type: 'msg', content });
    msgInput.value = '';
  }
  sendBtn.addEventListener('click', sendMsg);
  msgInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMsg(); });

  return { init: connect, sendRaw, isJoined: () => joined };
})();