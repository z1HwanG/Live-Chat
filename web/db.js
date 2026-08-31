// 数据访问层：生产环境用 MariaDB；本地开发未配置 DB_HOST 时降级为内存存储（仅测试用）

const mysql = require('mysql2/promise');

const USE_DB = !!process.env.DB_HOST;

// ---------- 内存实现（本地测试） ----------
function memStore() {
  const messages = [];
  const banned = new Map(); // nickname -> Date
  let seq = 1;
  return {
    async init() {},
    async addMessage(nickname, content, ip) {
      const m = { id: seq++, nickname, content, ip, created_at: new Date(), deleted: 0 };
      messages.push(m);
      if (messages.length > 1000) messages.splice(0, messages.length - 1000);
      return m;
    },
    async getMessages(limit, beforeId) {
      let list = messages.filter((m) => !m.deleted);
      if (beforeId) list = list.filter((m) => m.id < beforeId);
      return list
        .slice(-limit)
        .map((m) => ({ id: m.id, nickname: m.nickname, content: m.content, created_at: m.created_at }));
    },
    async markDeleted(id) {
      const m = messages.find((x) => x.id === Number(id));
      if (m) m.deleted = 1;
    },
    async isBanned(nickname) {
      const b = banned.get(nickname);
      return !!b && b.getTime() > Date.now();
    },
    async ban(nickname, until) { banned.set(nickname, new Date(until)); },
    async unban(nickname) { banned.delete(nickname); },
  };
}

// ---------- MariaDB 实现 ----------
function sqlStore() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'livechat',
    connectionLimit: 10,
    charset: 'utf8mb4',
  });
  return {
    pool,
    async init() { await pool.query('SELECT 1'); },
    async addMessage(nickname, content, ip) {
      const [r] = await pool.query(
        'INSERT INTO messages (nickname, content, ip) VALUES (?,?,?)',
        [nickname, content, ip]
      );
      const [rows] = await pool.query('SELECT * FROM messages WHERE id=?', [r.insertId]);
      return rows[0];
    },
    async getMessages(limit, beforeId) {
      const cols = 'id, nickname, content, created_at, deleted';
      const [rows] = beforeId
        ? await pool.query(
            `SELECT ${cols} FROM messages WHERE id<? AND deleted=0 ORDER BY id DESC LIMIT ?`,
            [beforeId, limit]
          )
        : await pool.query(
            `SELECT ${cols} FROM messages WHERE deleted=0 ORDER BY id DESC LIMIT ?`,
            [limit]
          );
      return rows.reverse();
    },
    async markDeleted(id) {
      await pool.query('UPDATE messages SET deleted=1 WHERE id=?', [id]);
    },
    async isBanned(nickname) {
      const [rows] = await pool.query(
        'SELECT until FROM banned WHERE nickname=? AND until > NOW() LIMIT 1',
        [nickname]
      );
      return rows.length > 0;
    },
    async ban(nickname, until) {
      await pool.query(
        'INSERT INTO banned (nickname, until) VALUES (?,?) ON DUPLICATE KEY UPDATE until=VALUES(until)',
        [nickname, new Date(until)]
      );
    },
    async unban(nickname) {
      await pool.query('DELETE FROM banned WHERE nickname=?', [nickname]);
    },
  };
}

const store = USE_DB ? sqlStore() : memStore();
if (!USE_DB) console.warn('[db] 未配置 DB_HOST，使用内存存储（仅本地测试，重启丢失）');

module.exports = store;
