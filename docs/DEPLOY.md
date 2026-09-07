# LiveChat 部署文档（Linux + Docker，一键拉起 web + SRS + 连接线上 PostgreSQL）

> 文中的 `live.example.com`、`127.0.0.1` 为示例占位符，部署时替换为你自己的域名/主机 IP。
> 本项目以 `docker compose up` 一键部署：LiveChat Web + SRS6 直播服务，通过 bridge 网络互通，连接线上已有的 PostgreSQL 聊天库。

## 一、环境要求

| 项目 | 说明 |
| --- | --- |
| 操作系统 | 任意主流 Linux 发行版（Ubuntu / Debian / CentOS 等） |
| Docker | 已安装 Docker Engine 与 Docker Compose 插件（compose v2） |
| 数据库 | 线上已有 PostgreSQL，含 `livechat` 库与 `messages`/`banned` 表（`db.js` 启动时也会幂等补表） |
| 域名 | 将你的域名 A 记录指向服务器公网 IP |

## 二、网络架构

```
                    ┌──────────────────────────────────────┐
                    │  Docker host                         │
                    │  ┌─── livechat (bridge) ──────────┐  │
                    │  │  web:3010  ←→  srs:1985        │  │ ← compose 内互通
                    │  └──────────┬──────────────────────┘  │
                    │             │ 172.17.0.1:5432         │ ← bridge 网关 → 宿主 PG
                    │  ┌──────────┴──────────────────────┐  │
                    │  │  PostgreSQL (线上已有)           │  │
                    │  └─────────────────────────────────┘  │
                    │  ┌─────────────────────────────────┐  │
                    │  │  OpenResty/Nginx/Caddy :443     │  │ ← 反向代理直播/页面
                    │  └─────────────────────────────────┘  │
                    └──────────────────────────────────────┘
```

- web 与 srs 同属 `livechat` bridge 网络，通过服务名 `web`、`srs` 互通
- web 通过 Docker 网关 IP（`172.17.0.1`）访问宿主上的 PostgreSQL
- SRS 的 `on_publish` 回调 payload 指向 compose 网络内的 `http://web:3010`

## 三、端口（默认值，可在 `.env` 调整）

| 环境变量 | 默认 | 协议 | 用途 | 是否对外 |
| --- | --- | --- | --- | --- |
| `PORT` | 3010 | TCP | LiveChat Web（页面/聊天/API） | 反代后是 |
| `RTMP_PORT` | 1935 | TCP | RTMP 推流（OBS） | 是 |
| `SRS_API_PORT` | 1985 | TCP | SRS HTTP API（内部 web 查询直播状态用） | 否 |
| `FLV_PORT` | 8080 | TCP | HTTP-FLV / HLS 直播流 | 是 |
| `RTC_PORT` | 8000 | UDP | WebRTC 媒体 | 是 |
| — | 5432 | TCP | PostgreSQL（线上已有） | 否 |

> 默认使用 SRS 标准端口 1935/1985/8080/8000。若与机器上其他 SRS 冲突，可在 `.env` 改为 1936/1986/8081/8001 等避开。

## 四、部署步骤

### 1. 上传项目到服务器

```bash
scp -r live-chat root@<服务器IP>:/opt/live-chat
```

### 2. 准备 .env

```bash
cd /opt/live-chat
cp .env.example .env
# 编辑 .env，关键项：
#   DB_USER / DB_PASSWORD / DB_HOST / DB_PORT / DB_NAME  线上 PostgreSQL 连接信息
#     DB_HOST 默认 172.17.0.1（Docker bridge 网关，连宿主 PG）
#   PUSH_TOKEN    推流密钥（OBS 推流 URL 的 token）
#   ADMIN_PASSWORD 管理员口令
#   PUBLIC_HOST   公网域名
#   SRS_CANDIDATE 本机公网 IP（WebRTC 用）
chmod 600 .env
```

### 3. 初始化数据库（可选，全新库才需要）

连接线上已有 `livechat` 库可跳过本步。全新安装时以 postgres 超管执行（`<超管用户>` 为线上 PG 的超级用户）：

```bash
sed "s/:DB_PASSWORD/$(grep ^DB_PASSWORD .env | cut -d= -f2)/" scripts/init-db.sql \
  | docker exec -i postgresql psql -U <超管用户> -v ON_ERROR_STOP=1
```

### 4. 一键构建并启动

```bash
docker compose up -d --build
sleep 3
curl http://127.0.0.1:3010/api/config   # 应返回 JSON
curl http://127.0.0.1:1985/api/v1/streams/  # SRS API 应返回 {"code":0,...}
```

### 5. 配置反向代理与 SSL

页面/聊天经 `PORT(3010)`，直播流经 `FLV_PORT(8080)`，WebRTC 信令经 `SRS_API_PORT(1985)` 对外。Nginx 示例（假设域名 `live.example.com`，SRS 端口用标准默认值）：

```nginx
server {
    listen 80;
    server_name live.example.com;

    # 聊天 WebSocket -> LiveChat（必须带 Upgrade 头）
    location /ws {
        proxy_pass http://127.0.0.1:3010;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }

    # HTTP-FLV / HLS 直播流 -> SRS :8080
    location /live/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_buffering off;
        proxy_cache off;
    }

    # WebRTC 信令 -> SRS API :1985
    location /rtc/ {
        proxy_pass http://127.0.0.1:1985;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # 页面 / API -> LiveChat
    location / {
        proxy_pass http://127.0.0.1:3010;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

SSL 用 Certbot 或 Caddy 自动签发续期（同前文标准做法）。

### 6. 验证

| 检查项 | 命令 / 地址 |
| --- | --- |
| 页面 | `https://live.example.com` |
| Web API | `https://live.example.com/api/config` |
| 聊天 | 页面输昵称回车加入，发消息 |
| 直播 | OBS 推 `rtmp://<host>:1935/live/stream?token=<PUSH_TOKEN>`，页面自动/手动切模式播放 |

## 五、与 SRS 的对接（compose 内置）

- **推流鉴权**：SRS 的 `on_publish` 回调指向 compose 网络内的 `http://web:3010/api/srs/on_publish`（见 `srs/srs.conf`）
- **直播状态**：web 通过环境变量 `SRS_API`（默认 `http://srs:1985`）查询 SRS 是否在播（见 `web/server.js`）
- **播放器**：`web/public/js/player.js` 已实现 WebRTC/FLV/HLS 自适应回退

## 六、常见问题

- **聊天打不开**：确认反代 `/ws` 带 Upgrade 头；`docker logs livechat-web` 看报错。
- **数据库连不上**：确认 `.env` 的 DB 四件套与线上 PG 一致；`docker logs livechat-web` 出现 `db.js:53` 即 DB 初始化失败。注意 web 跑在 bridge 网络里，连宿主 PG 用网关 IP（默认 `172.17.0.1`，非 `127.0.0.1`）。
- **直播页面有噪声/音质差**：多为 WebRTC 模式（超低延迟按钮）下 SRS 做 AAC→Opus 转码导致；默认"自动"走 FLV 直出 AAC 音质干净。
- **内存偏小（2G）**：LiveChat 常驻约 150MB，一般够用。