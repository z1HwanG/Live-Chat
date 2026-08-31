# LiveChat 网页聊天系统

基于 Node.js 的轻量网页聊天室，支持历史消息、在线人数、断线重连、管理员禁言/删消息等。

## 架构

```
[浏览器] --HTTPS(443)--> Nginx / Caddy 反代 --> LiveChat Web :3010
LiveChat Web --MariaDB/MySQL(:3306)--> 聊天历史持久化
```

SRS6 直播服务由用户自行部署，LiveChat 通过 `POST /api/srs/on_publish` 提供推流鉴权回调。

## 目录结构

```
├── docker-compose.yml      # LiveChat Web 服务编排
├── .env.example            # 环境变量模板（含推流密钥/管理员口令）
├── web/                    # Node.js 服务：页面 + 聊天 WS + API + SRS 鉴权
│   └── public/             # 前端：聊天 + 管理 + 播放器
├── scripts/
│   ├── deploy.sh           # 通用 Linux 一键部署脚本
│   └── init-db.sql         # 数据库初始化
└── docs/
    └── DEPLOY.md           # 部署文档（含反向代理与 SSL 说明）
```

## 功能

- **文字聊天**：昵称、历史消息、在线人数、断线重连、XSS 防护、发送限速
- **管理员**：口令登录后可删消息、禁言（按分钟）、解除禁言（注意：禁言功能请善用：目前尚未提供解禁功能；若设置禁言时长为0分钟，则按10分钟生效。）
- **推流鉴权**：提供 SRS `on_publish` 回调接口，防陌生人顶流（SRS 由用户自行部署）
- **可选直播播放器**：WebRTC / FLV / HLS 自适应播放（需自行部署 SRS）

## 快速开始

见 `docs/DEPLOY.md`（部署与 SSL 配置）。