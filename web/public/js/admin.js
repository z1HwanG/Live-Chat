// 管理员：口令登录后，在线用户列表 + 直接踢人/禁言/解禁
window.Admin = (function () {
  let token = sessionStorage.getItem('lc_admin_token') || '';
  let mode = !!token;
  let banMinutes = 10;

  const modal = document.getElementById('adminModal');
  const loginBox = document.getElementById('adminLogin');
  const panelBox = document.getElementById('adminPanel');
  const passInput = document.getElementById('adminPass');
  const onlineListEl = document.getElementById('adminOnlineList');
  const banInput = document.getElementById('adminBanMinutes');
  const banMinus = document.getElementById('adminBanMinus');
  const banPlus = document.getElementById('adminBanPlus');
  const refreshBtn = document.getElementById('adminRefresh');

  function showModal() {
    modal.classList.remove('hidden');
    if (mode) { showPanel(); refreshList(); }
  }
  function hideModal() { modal.classList.add('hidden'); }
  function showPanel() {
    loginBox.classList.add('hidden');
    panelBox.classList.remove('hidden');
    banInput.value = banMinutes;
  }
  function showLogin() {
    loginBox.classList.remove('hidden');
    panelBox.classList.add('hidden');
  }

  // 请求在线用户列表
  function refreshList() {
    if (!mode) return;
    window.Chat.sendRaw({ type: 'admin', action: 'get_online', token });
  }

  function renderList(list) {
    if (!onlineListEl) return;
    if (!list.length) {
      onlineListEl.innerHTML = '<div class="admin-empty">当前直播间无人</div>';
      return;
    }
    onlineListEl.innerHTML = '';
    list.forEach((u) => {
      const row = document.createElement('div');
      row.className = 'admin-user';

      const info = document.createElement('div');
      info.className = 'admin-user-info';
      const nm = document.createElement('span');
      nm.className = 'admin-user-nick';
      nm.textContent = u.nickname;
      const ip = document.createElement('span');
      ip.className = 'admin-user-ip';
      ip.textContent = u.ip;
      info.appendChild(nm);
      info.appendChild(ip);

      const ops = document.createElement('div');
      ops.className = 'admin-user-ops';

      const kickBtn = document.createElement('button');
      kickBtn.className = 'mini-btn danger';
      kickBtn.textContent = '踢出';
      kickBtn.title = '踢出直播间';
      kickBtn.addEventListener('click', () => {
        if (confirm('把 ' + u.nickname + ' 移出直播间？')) {
          window.Chat.sendRaw({ type: 'admin', action: 'kick', nickname: u.nickname, token });
        }
      });

      const banBtn = document.createElement('button');
      banBtn.className = 'mini-btn warn';
      banBtn.textContent = '禁言';
      banBtn.title = '禁言 ' + banMinutes + ' 分钟';
      banBtn.addEventListener('click', () => {
        window.Chat.sendRaw({ type: 'admin', action: 'ban', nickname: u.nickname, minutes: banMinutes, token });
      });

      const unbanBtn = document.createElement('button');
      unbanBtn.className = 'mini-btn ok';
      unbanBtn.textContent = '解禁';
      unbanBtn.title = '解除禁言';
      unbanBtn.addEventListener('click', () => {
        window.Chat.sendRaw({ type: 'admin', action: 'unban', nickname: u.nickname, token });
      });

      ops.appendChild(kickBtn);
      ops.appendChild(banBtn);
      ops.appendChild(unbanBtn);

      row.appendChild(info);
      row.appendChild(ops);

      onlineListEl.appendChild(row);
    });
  }

  document.getElementById('adminBtn').addEventListener('click', showModal);
  document.getElementById('adminClose').addEventListener('click', hideModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) hideModal(); });

  document.getElementById('adminLoginBtn').addEventListener('click', async () => {
    const p = passInput.value;
    if (!p) return;
    try {
      const r = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: p })
      });
      const d = await r.json();
      if (d.ok) {
        token = d.token;
        mode = true;
        sessionStorage.setItem('lc_admin_token', token);
        passInput.value = '';
        showPanel();
        refreshList();
        toast('管理员已登录');
      } else {
        toast('口令错误');
      }
    } catch (e) { toast('登录失败'); }
  });

  document.getElementById('adminLogoutBtn').addEventListener('click', () => {
    token = '';
    mode = false;
    sessionStorage.removeItem('lc_admin_token');
    showLogin();
  });

  // 禁言分钟数：输入框 +/- 按钮
  banMinus.addEventListener('click', () => {
    banMinutes = Math.max(1, (parseInt(banInput.value) || 10) - 5);
    banInput.value = banMinutes;
  });
  banPlus.addEventListener('click', () => {
    banMinutes = Math.max(1, (parseInt(banInput.value) || 10) + 5);
    banInput.value = banMinutes;
  });
  banInput.addEventListener('change', () => {
    banMinutes = Math.max(1, parseInt(banInput.value) || 10);
    banInput.value = banMinutes;
  });
  refreshBtn.addEventListener('click', refreshList);

  // 保留旧的消息悬浮操作（删除/禁言），供聊天消息行用
  function attachOps(li, m) {
    const ops = document.createElement('span');
    ops.className = 'msg-ops';

    const delBtn = document.createElement('button');
    delBtn.textContent = '删除';
    delBtn.title = '删除这条消息';
    delBtn.addEventListener('click', () => {
      if (confirm('删除这条消息？')) {
        window.Chat.sendRaw({ type: 'admin', action: 'delete', id: m.id, token });
      }
    });

    const banBtn = document.createElement('button');
    banBtn.textContent = '禁言';
    banBtn.title = '禁言' + banMinutes + '分钟';
    banBtn.addEventListener('click', () => {
      window.Chat.sendRaw({ type: 'admin', action: 'ban', nickname: m.nickname, minutes: banMinutes, token });
    });

    ops.appendChild(delBtn);
    ops.appendChild(banBtn);
    li.appendChild(ops);
  }

  return { init() {}, isMode: () => mode, attachOps, renderList, refreshList };
})();