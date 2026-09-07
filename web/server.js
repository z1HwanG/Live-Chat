// SRS6 直播聊天 Web 服务
// 功能：静态页面、聊天 WebSocket、历史消息、管理员（禁言/删消息/踢人）、
//       在线人数（播放器心跳）、SRS 推流鉴权回调（on_publish）

const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const store = require('./db');

const PORT = parseInt(process.env.PORT || '3010', 10);
const SRS_API = process.env.SRS_API || 'http://127.0.0.1:1985'; // SRS HTTP API 基地址（compose 内为 http://srs:1985）
const PUSH_TOKEN = process.env.PUSH_TOKEN || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SITE_NAME = process.env.SITE_NAME || '我的直播';
const STREAM_NAME = process.env.STREAM_NAME || 'stream';
const PUBLIC_HOST = process.env.PUBLIC_HOST || 'live.example.com';

// 播放器心跳 -> 在线观看人数（按 IP 去重）
const viewers = new Map(); // ip -> lastSeen(ms)
// 管理员 token -> 过期时间(ms)
const adminTokens = new Map();
// 消息限速：ip -> {count, resetAt}
const rateLimit = new Map();

const app = express();
app.set('trust proxy', true); // 使用 X-Forwarded-For 取真实 IP（反代之后）
app.use(express.json());

// 静态页面（public/）
app.use(express.static(path.join(__dirname, 'public')));

// ---------- 页面配置 ----------
app.get('/api/config', (req, res) => {
  res.json({
    siteName: SITE_NAME,
    stream: STREAM_NAME,
    publicHost: PUBLIC_HOST,
    rtmpUrl: `rtmp://${PUBLIC_HOST}:1935/live`,
  });
});

// ---------- 播放器心跳（在线观看人数） ----------
app.post('/api/heartbeat', (req, res) => {
  const ip = clientIp(req);
  if (ip) viewers.set(ip, Date.now());
  res.json({ ok: true });
});

// ---------- 历史消息 ----------
app.get('/api/messages', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const beforeId = req.query.before_id ? parseInt(req.query.before_id) : null;
    const list = await store.getMessages(limit, beforeId);
    res.json({ ok: true, messages: list });
  } catch (e) {
    console.error('[messages]', e);
    res.status(500).json({ ok: false, error: '数据库错误' });
  }
});

// ---------- 管理员登录 ----------
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (!ADMIN_PASSWORD || password !== ADMIN_PASSWORD) {
    return res.status(403).json({ ok: false, error: '口令错误' });
  }
  const token = crypto.randomBytes(16).toString('hex');
  adminTokens.set(token, Date.now() + 24 * 3600 * 1000);
  res.json({ ok: true, token });
});

// ---------- SRS 推流鉴权回调 ----------
// OBS 推流地址：rtmp://host:1935/live/<stream>?token=<PUSH_TOKEN>
// SRS 调用本接口：返回 {"code":0} 允许，其他拒绝。
app.post('/api/srs/on_publish', (req, res) => {
  const b = req.body || {};
  const param = new URLSearchParams(String(b.param || ''));
  const ok =
    !!PUSH_TOKEN && param.get('token') === PUSH_TOKEN && b.stream === STREAM_NAME;
  console.log(
    `[on_publish] app=${b.app} stream=${b.stream} ip=${b.ip} param=${b.param} -> ${ok ? '允许' : '拒绝'}`
  );
  res.json({ code: ok ? 0 : 1 });
});

app.post('/api/srs/on_unpublish', (req, res) => {
  console.log(`[on_unpublish] app=${req.body?.app} stream=${req.body?.stream}`);
  res.json({ code: 0 });
});

// ---------- 直播状态（查询 SRS API，判断是否正在推流） ----------
app.get('/api/live/status', async (req, res) => {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch(`${SRS_API}/api/v1/streams/`, { signal: ctrl.signal });
    clearTimeout(timer);
    const data = await r.json();
    const live = (data.streams || []).some(
      (s) => s.app === 'live' && s.name === STREAM_NAME
    );
    res.json({ ok: true, live });
  } catch (e) {
    res.json({ ok: true, live: false, error: 'srs api 不可用' });
  }
});

const server = http.createServer(app);

// ================= WebSocket 聊天 =================
const wss = new WebSocketServer({ server, path: '/ws' });
const clients = new Map(); // ws -> {nickname, ip}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket.remoteAddress || '';
}

function broadcast(obj) {
  const data = JSON.stringify(obj);
  for (const ws of clients.keys()) {
    if (ws.readyState === 1) ws.send(data);
  }
}

function countViewers() {
  const now = Date.now();
  for (const [ip, ts] of viewers) if (now - ts > 90000) viewers.delete(ip);
  return viewers.size;
}

function adminOk(token) {
  if (!token) return false;
  const exp = adminTokens.get(token);
  return !!exp && exp > Date.now();
}

function broadcastCount() {
  broadcast({ type: 'count', online: clients.size, viewers: countViewers() });
}

wss.on('connection', (ws, req) => {
  const ip = clientIp(req);
  clients.set(ws, { nickname: '', ip });
  broadcastCount();

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    // 加入聊天室
    if (msg.type === 'join') {
      const nickname = String(msg.nickname || '').trim().slice(0, 16);
      if (!nickname) {
        return ws.send(JSON.stringify({ type: 'error', text: '昵称不能为空' }));
      }
      for (const [w, info] of clients) {
        if (w !== ws && info.nickname === nickname) {
          return ws.send(JSON.stringify({ type: 'error', text: '昵称已被占用，换一个吧' }));
        }
      }
      clients.set(ws, { nickname, ip });
      const history = await store.getMessages(50, null);
      ws.send(
        JSON.stringify({
          type: 'hello',
          nickname,
          history,
          online: clients.size,
          viewers: countViewers(),
          siteName: SITE_NAME,
        })
      );
      broadcast({ type: 'sys', text: `${nickname} 加入了直播间`, time: Date.now() });
      broadcastCount();
      return;
    }

    const info = clients.get(ws);
    if (!info || !info.nickname) return;

    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', t: Date.now() }));
      return;
    }

    // 管理员操作
    if (msg.type === 'admin') {
      if (!adminOk(msg.token)) {
        return ws.send(JSON.stringify({ type: 'error', text: '管理员口令无效或已过期' }));
      }
      const act = msg.action;
      if (act === 'delete') {
        const id = Number(msg.id);
        if (id) {
          await store.markDeleted(id);
          broadcast({ type: 'delete', id });
        }
      } else if (act === 'ban') {
        const nick = String(msg.nickname || '').trim().slice(0, 16);
        const minutes = Math.max(1, parseInt(msg.minutes) || 10);
        if (nick) {
          const until = new Date(Date.now() + minutes * 60000);
          await store.ban(nick, until);
          broadcast({ type: 'sys', text: `${nick} 已被禁言 ${minutes} 分钟`, time: Date.now() });
          broadcast({ type: 'adminlog', text: `管理员禁言了 ${nick} ${minutes} 分钟` });
        }
      } else if (act === 'unban') {
        const nick = String(msg.nickname || '').trim().slice(0, 16);
        if (nick) {
          await store.unban(nick);
          broadcast({ type: 'sys', text: `${nick} 已解除禁言`, time: Date.now() });
          broadcast({ type: 'adminlog', text: `管理员解禁了 ${nick}` });
        }
      } else if (act === 'kick') {
        const nick = String(msg.nickname || '').trim().slice(0, 16);
        for (const [w, inf] of clients) {
          if (inf.nickname === nick) {
            w.send(JSON.stringify({ type: 'error', text: '你已被移出直播间' }));
            w.close();
          }
        }
        broadcast({ type: 'adminlog', text: `管理员将 ${nick} 移出直播间` });
      } else if (act === 'get_online') {
        const list = [];
        for (const [w, inf] of clients) {
          if (inf.nickname) list.push({ nickname: inf.nickname, ip: inf.ip });
        }
        ws.send(JSON.stringify({ type: 'online_list', list }));
        return;
      }
      return;
    }

    // 普通聊天消息
    if (msg.type === 'msg') {
      const content = String(msg.content || '').trim().slice(0, 200);
      if (!content) return;

      // 限速：每 IP 3 秒 1 条
      const now = Date.now();
      const rl = rateLimit.get(ip) || { count: 0, resetAt: now + 3000 };
      if (now > rl.resetAt) {
        rl.count = 0;
        rl.resetAt = now + 3000;
      }
      rl.count++;
      rateLimit.set(ip, rl);
      if (rl.count > 1) {
        return ws.send(JSON.stringify({ type: 'error', text: '发送太快，请稍等片刻' }));
      }

      if (await store.isBanned(info.nickname)) {
        return ws.send(JSON.stringify({ type: 'error', text: '你已被禁言，无法发送消息' }));
      }

      const m = await store.addMessage(info.nickname, content, ip);
      broadcast({
        type: 'chat',
        id: m.id,
        nickname: info.nickname,
        content,
        time: m.created_at ? new Date(m.created_at).getTime() : Date.now(),
      });
    }
  });

  ws.on('close', () => {
    const info = clients.get(ws);
    clients.delete(ws);
    if (info && info.nickname) {
      broadcast({ type: 'sys', text: `${info.nickname} 离开了直播间`, time: Date.now() });
    }
    broadcastCount();
  });
});

setInterval(broadcastCount, 15000);

// 清理过期 token 与限速表
setInterval(() => {
  const now = Date.now();
  for (const [t, e] of adminTokens) if (e < now) adminTokens.delete(t);
  for (const [ip, rl] of rateLimit) if (rl.resetAt < now) rateLimit.delete(ip);
}, 60000);

store
  .init()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`[livechat-web] http://127.0.0.1:${PORT} site=${SITE_NAME} stream=${STREAM_NAME}`);
    });
  })
  .catch((e) => {
    console.error('[init] 初始化失败:', e);
    process.exit(1);
  });
