#!/usr/bin/env bash
# ============================================================
# LiveChat 一键部署脚本（Linux + Docker）
# 仅部署 LiveChat Web 服务；SRS6 直播服务由用户自行部署。
# 在项目根目录执行：bash scripts/deploy.sh
# 前置：
#   - 已安装 Docker Engine 与 Docker Compose 插件
#   - 已准备 MariaDB/MySQL（本机或容器），或设置 MARIADB_CONTAINER 自动初始化
#   - 域名 A 记录已指向服务器公网 IP
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."

log() { echo -e "\033[1;32m[ok]\033[0m $1"; }

# ---------- 1. .env ----------
if [ ! -f .env ]; then
  if [ -z "${DB_PASSWORD:-}" ]; then DB_PASSWORD=$(openssl rand -hex 12); fi
  if [ -z "${PUSH_TOKEN:-}" ]; then PUSH_TOKEN=$(openssl rand -hex 12); fi
  if [ -z "${ADMIN_PASSWORD:-}" ]; then ADMIN_PASSWORD=$(openssl rand -hex 6); fi
  if [ -z "${PUBLIC_HOST:-}" ]; then PUBLIC_HOST=live.example.com; fi
  cat > .env <<EOF
DB_USER=livechat
DB_PASSWORD=$DB_PASSWORD
PUSH_TOKEN=$PUSH_TOKEN
ADMIN_PASSWORD=$ADMIN_PASSWORD
PUBLIC_HOST=$PUBLIC_HOST
SITE_NAME=我的直播
EOF
  chmod 600 .env
  log "已生成 .env（请妥善保管 PUSH_TOKEN / ADMIN_PASSWORD / PUBLIC_HOST）"
else
  set -a; source .env; set +a
fi
: "${DB_USER:?}" "${DB_PASSWORD:?}" "${PUSH_TOKEN:?}" "${ADMIN_PASSWORD:?}" "${PUBLIC_HOST:?}"

# ---------- 2. 数据库初始化（可选） ----------
# 设置 MARIADB_CONTAINER 后会自动执行 scripts/init-db.sql。
# 例如：MARIADB_CONTAINER=mariadb bash scripts/deploy.sh
MARIADB="${MARIADB_CONTAINER:-}"
if [ -n "$MARIADB" ]; then
  DB_ROOT_PASS="${DB_ROOT_PASS:-}"
  if [ -z "$DB_ROOT_PASS" ]; then
    read -s -p "请输入数据库 root 密码: " DB_ROOT_PASS; echo
  fi
  sed "s/__DB_PASSWORD__/$DB_PASSWORD/g" scripts/init-db.sql > /tmp/init-db.sql
  docker exec -i "$MARIADB" mysql -uroot -p"$DB_ROOT_PASS" < /tmp/init-db.sql
  log "数据库初始化完成（库 livechat，用户 $DB_USER）"
else
  echo "提示: 未设置 MARIADB_CONTAINER，跳过数据库自动初始化。"
  echo "      请手动执行 scripts/init-db.sql，或使用 MARIADB_CONTAINER=<容器名> bash scripts/deploy.sh"
fi

# ---------- 3. 构建并启动 LiveChat ----------
docker compose up -d --build
sleep 3
curl -sf http://127.0.0.1:3010/api/config > /dev/null || { echo "LiveChat 服务未就绪"; exit 1; }
log "LiveChat 已启动（端口 3010）"

# ---------- 4. 汇总 ----------
echo
echo "================ 部署完成 ================"
echo "访问地址: https://$PUBLIC_HOST"
echo "管理员口令: $ADMIN_PASSWORD"
echo "（反向代理与 SSL 配置见 docs/DEPLOY.md）"