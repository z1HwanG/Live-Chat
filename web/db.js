// 数据访问层：PostgreSQL 驱动（pg）
// 与线上 livechat 库的 PostgreSQL 方言表结构（messages/banned）兼容。
// 未配置 DB_HOST 时降级为内存存储（仅本地测试用）。

const { Pool } = require('pg');

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

// ---------- PostgreSQL 实现 ----------
function pgStore() {
  const pool = new Pool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'livechat',
    max: 10,
  });
  return {
    pool,
    async init() {
      // 确保表结构存在（幂等）；线上已有库则直接通过
      await pool.query(`
        CREATE TABLE IF NOT EXISTS messages (
          id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          nickname   varchar(32)  NOT NULL,
          content    varchar(500) NOT NULL,
          ip         varchar(45)  NOT NULL DEFAULT '',
          created_at timestamptz  NOT NULL DEFAULT CURRENT_TIMESTAMP,
          deleted    boolean      NOT NULL DEFAULT false
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_created ON messages (created_at)
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS banned (
          nickname varchar(32) NOT NULL PRIMARY KEY,
          until    timestamptz NOT NULL
        )
      `);
      // 冒烟验证连接
      await pool.query('SELECT 1');
    },
    async addMessage(nickname, content, ip) {
      const { rows } = await pool.query(
        'INSERT INTO messages (nickname, content, ip) VALUES ($1,$2,$3) RETURNING id, nickname, content, created_at, deleted',
        [nickname, content, ip]
      );
      return rows[0];
    },
    async getMessages(limit, beforeId) {
      const cols = 'id, nickname, content, created_at, deleted';
      const { rows } = beforeId
        ? await pool.query(
            `SELECT ${cols} FROM messages WHERE id < $1 AND deleted = false ORDER BY id DESC LIMIT $2`,
            [beforeId, limit]
          )
        : await pool.query(
            `SELECT ${cols} FROM messages WHERE deleted = false ORDER BY id DESC LIMIT $1`,
            [limit]
          );
      return rows.reverse();
    },
    async markDeleted(id) {
      await pool.query('UPDATE messages SET deleted = true WHERE id = $1', [id]);
    },
    async isBanned(nickname) {
      const { rows } = await pool.query(
        'SELECT 1 FROM banned WHERE nickname = $1 AND until > now() LIMIT 1',
        [nickname]
      );
      return rows.length > 0;
    },
    async ban(nickname, until) {
      await pool.query(
        'INSERT INTO banned (nickname, until) VALUES ($1,$2) ON CONFLICT (nickname) DO UPDATE SET until = EXCLUDED.until',
        [nickname, new Date(until)]
      );
    },
    async unban(nickname) {
      await pool.query('DELETE FROM banned WHERE nickname = $1', [nickname]);
    },
  };
}

const store = USE_DB ? pgStore() : memStore();
if (!USE_DB) console.warn('[db] 未配置 DB_HOST，使用内存存储（仅本地测试，重启丢失）');

module.exports = store;
