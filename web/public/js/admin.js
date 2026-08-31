// 管理员：口令登录后获得禁言/删消息权限
window.Admin = (function () {
  let token = sessionStorage.getItem('lc_admin_token') || '';
  let mode = !!token;

  const modal = document.getElementById('adminModal');
  const loginBox = document.getElementById('adminLogin');
  const panelBox = document.getElementById('adminPanel');
  const passInput = document.getElementById('adminPass');

  function showModal() {
    modal.classList.remove('hidden');
    if (mode) showPanel();
  }
  function hideModal() { modal.classList.add('hidden'); }
  function showPanel() { loginBox.classList.add('hidden'); panelBox.classList.remove('hidden'); }
  function showLogin() { loginBox.classList.remove('hidden'); panelBox.classList.add('hidden'); }

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

  // 给消息行附加 删除/禁言 按钮
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
    banBtn.title = '禁言该用户';
    banBtn.addEventListener('click', () => {
      const minutes = parseInt(prompt('禁言多少分钟？', '10'), 10) || 10;
      window.Chat.sendRaw({ type: 'admin', action: 'ban', nickname: m.nickname, minutes, token });
    });

    ops.appendChild(delBtn);
    ops.appendChild(banBtn);
    li.appendChild(ops);
  }

  return { init() {}, isMode: () => mode, attachOps };
})();
