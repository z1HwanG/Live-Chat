-- 直播聊天数据库初始化（由 deploy.sh 以 MariaDB root 执行）
-- 占位符 __DB_PASSWORD__ 会被部署脚本替换为 .env 中的 DB_PASSWORD

CREATE DATABASE IF NOT EXISTS livechat
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'livechat'@'localhost' IDENTIFIED BY '__DB_PASSWORD__';
CREATE USER IF NOT EXISTS 'livechat'@'127.0.0.1' IDENTIFIED BY '__DB_PASSWORD__';
CREATE USER IF NOT EXISTS 'livechat'@'%' IDENTIFIED BY '__DB_PASSWORD__';
GRANT ALL PRIVILEGES ON livechat.* TO 'livechat'@'localhost';
GRANT ALL PRIVILEGES ON livechat.* TO 'livechat'@'127.0.0.1';
GRANT ALL PRIVILEGES ON livechat.* TO 'livechat'@'%';
FLUSH PRIVILEGES;

USE livechat;

CREATE TABLE IF NOT EXISTS messages (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nickname   VARCHAR(32)  NOT NULL,
  content    VARCHAR(500) NOT NULL,
  ip         VARCHAR(45)  NOT NULL DEFAULT '',
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted    TINYINT      NOT NULL DEFAULT 0,
  INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS banned (
  nickname VARCHAR(32) NOT NULL PRIMARY KEY,
  until    DATETIME    NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
