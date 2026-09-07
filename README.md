# LiveChat 网页聊天 + SRS 直播系统

基于 Node.js 的轻量网页聊天室 + SRS6 直播服务，支持历史消息、在线人数、断线重连、管理员禁言/删消息/踢人、推流鉴权、WebRTC/FLV/HLS 多模式播放。

## 架构

```
[浏览器] --HTTPS(443)--> Nginx/Caddy/OpenResty 反代
                           ├── LiveChat Web :3010（页面/聊天/API/推流鉴权）
                           ├── SRS6 直播 :1935/8080/8000（RTMP 推流 + FLV/HLS/WebRTC 播放）
                           └── PostgreSQL :5432（聊天历史持久化，可连线上已有库）
```

web 与 srs 通过 docker compose bridge 网络互通，`docker compose up` 一键拉起完整系统。

## 目录结构

```
├── docker-compose.yml      # 一键部署编排（web + srs，bridge 网络，连接线上 PostgreSQL）
├── .env.example            # 环境变量模板（DB/PUSH_TOKEN/管理员口令/SRS 端口等）
├── web/                    # Node.js 服务：页面 + 聊天 WS + API + SRS 鉴权
│   └── public/             # 前端：聊天 + 管理 + 播放器
├── srs/                    # SRS 6 配置（compose 挂载，on_publish 回调 web 服务名）
├── scripts/
│   ├── deploy.sh           # 通用 Linux 一键部署脚本
│   └── init-db.sql         # 数据库初始化（PostgreSQL 版）
└── docs/
    └── DEPLOY.md           # 部署文档（含反向代理与 SSL 说明）
```

## 功能

- **文字聊天**：昵称、历史消息、在线人数、断线重连、XSS 防护、发送限速
- **管理员**：口令登录后，在线用户列表（昵称+IP），直接踢人/禁言/解禁/删消息，操作记录广播
- **推流鉴权**：SRS `on_publish` 回调 compose 内 `web:3010`，防陌生人顶流
- **直播播放器**：WebRTC（超低延迟）/ FLV（低延迟）/ HLS（高兼容）自适应播放

## 快速开始

```bash
cp .env.example .env   # 填 DB 连接、PUSH_TOKEN、ADMIN_PASSWORD、SRS_CANDIDATE
docker compose up -d --build
```

详见 `docs/DEPLOY.md`。