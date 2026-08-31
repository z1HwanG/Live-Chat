# LiveChat 部署文档（Linux + Docker）

> 文中的 `live.example.com` 为示例占位符，部署时请替换为你自己的域名。
> 本项目仅包含 LiveChat（网页、聊天、管理 API）。SRS6 直播服务由用户自行部署，LiveChat 通过接口与 SRS 对接。

## 一、环境要求

| 项目 | 说明 |
| --- | --- |
| 操作系统 | 任意主流 Linux 发行版（Ubuntu / Debian / CentOS 等） |
| Docker | 已安装 Docker Engine 与 Docker Compose 插件 |
| 数据库 | MariaDB 或 MySQL，可使用系统服务或 Docker 容器，端口 3306 |
| 域名 | 将 `live.example.com` 的 A 记录指向你的服务器公网 IP |

## 二、端口

| 端口 | 协议 | 用途 | 是否对外 |
| --- | --- | --- | --- |
| 80 / 443 | TCP | 反向代理 / HTTPS | 是 |
| 3010 | TCP | LiveChat Web 服务（仅本机反代访问） | 否 |
| 3306 | TCP | 数据库（仅本机） | 否 |

请在防火墙 / 安全组中放行 **80/443**。

## 三、部署步骤

### 1. 上传项目到服务器

```bash
scp -r live-chat root@<服务器IP>:/opt/live-chat
```

### 2. 准备 .env

```bash
cd /opt/live-chat
cp .env.example .env
# 编辑 .env：填 DB_PASSWORD（自定义）、ADMIN_PASSWORD（管理员口令）、PUBLIC_HOST（你的域名）
chmod 600 .env
```

### 3. 初始化数据库

将 `scripts/init-db.sql` 中的 `__DB_PASSWORD__` 替换为 `.env` 中的 `DB_PASSWORD` 后执行。

如果数据库运行在 Docker 容器中（容器名假设为 `mariadb`）：

```bash
sed "s/__DB_PASSWORD__/$(grep DB_PASSWORD .env | cut -d= -f2)/" scripts/init-db.sql | docker exec -i mariadb mysql -uroot -p'数据库root密码'
```

如果使用系统 MariaDB/MySQL 服务：

```bash
sed "s/__DB_PASSWORD__/$(grep DB_PASSWORD .env | cut -d= -f2)/" scripts/init-db.sql | mysql -uroot -p'数据库root密码'
```

会创建：库 `livechat`、用户 `livechat`、表 `messages` / `banned`。

### 4. 构建并启动 LiveChat

```bash
docker compose up -d --build
curl http://127.0.0.1:3010/api/config   # 应返回 JSON
```

### 5. 配置反向代理与 SSL

LiveChat 只监听本机 `3010` 端口，需要通过 Nginx、Caddy 等反向代理对外提供 HTTPS。

**Nginx 示例**

在 `/etc/nginx/conf.d/live.example.com.conf` 中写入：

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

> 如果同时提供直播，请根据你自行部署的 SRS 实际端口，将 `/live/`、`/rtc/` 等路径反向代理到对应的 SRS 服务。

**SSL 配置说明**

- 推荐使用 Certbot 自动申请和续期 Let's Encrypt 证书：

  ```bash
  certbot --nginx -d live.example.com
  ```

  Certbot 会自动修改上面的 Nginx 配置并启用 HTTPS。

- 如果使用 Caddy，只需在 `Caddyfile` 中写：

  ```
  live.example.com {
      reverse_proxy 127.0.0.1:3010
  }
  ```

  Caddy 会自动申请、续期 HTTPS 证书。

### 6. 验证

| 检查项 | 命令 / 地址 |
| --- | --- |
| 页面 | `https://live.example.com` |
| Web API | `https://live.example.com/api/config` |
| 聊天 | 页面里输昵称回车加入，发消息 |

## 四、与 SRS 的对接（由用户自行部署）

- LiveChat 提供推流鉴权回调接口：`POST /api/srs/on_publish`。
- 在你自行部署的 SRS 中，将 `on_publish` 回调指向 `http://127.0.0.1:3010/api/srs/on_publish` 即可。
- LiveChat 的直播状态接口会访问 `http://127.0.0.1:1985/api/v1/streams/` 查询 SRS 状态；如果 SRS 不在本机或端口不同，请自行调整 `web/server.js` 中的地址。

## 五、常见问题

- **聊天打不开**：确认反向代理的 `/ws` location 带 Upgrade 头；`docker logs livechat-web` 看报错。
- **数据库连不上**：确认 `.env` 中 `DB_HOST`、`DB_PORT`、`DB_USER`、`DB_PASSWORD` 与数据库实际配置一致。
- **内存偏小（2G）**：LiveChat 常驻约 150MB，一般够用。