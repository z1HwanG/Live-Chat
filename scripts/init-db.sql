-- 直播聊天数据库初始化（PostgreSQL 版）
-- 供全新安装时初始化库/用户；若连接线上已有 livechat 库（表已存在）可跳过本脚本，
-- web 服务启动时 db.js 也会幂等创建缺失的表。
-- 用法：以 postgres 超级用户执行，把 :DB_PASSWORD 替换为 .env 中 DB_PASSWORD。
-- 示例：sed "s/:DB_PASSWORD/<你的密码>/" scripts/init-db.sql | \
--       docker exec -i postgresql psql -U <超管用户> -v ON_ERROR_STOP=1

-- 1. 创建用户（已存在则重置密码）
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'livechat') THEN
    CREATE ROLE livechat LOGIN PASSWORD ':DB_PASSWORD';
  ELSE
    ALTER ROLE livechat PASSWORD ':DB_PASSWORD';
  END IF;
END
$$;

-- 2. 创建库（已存在则跳过）并授权
SELECT format('CREATE DATABASE %I OWNER livechat', 'livechat')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'livechat')\gexec
GRANT ALL PRIVILEGES ON DATABASE livechat TO livechat;

-- 3. 建表（连接 livechat 库后执行；web 启动时也会幂等创建）
\connect livechat
CREATE TABLE IF NOT EXISTS messages (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nickname   varchar(32)  NOT NULL,
  content    varchar(500) NOT NULL,
  ip         varchar(45)  NOT NULL DEFAULT '',
  created_at timestamptz  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted    boolean      NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_created ON messages (created_at);
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO livechat;

CREATE TABLE IF NOT EXISTS banned (
  nickname varchar(32) NOT NULL PRIMARY KEY,
  until    timestamptz NOT NULL
);
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO livechat;