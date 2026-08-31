FROM node:20-alpine

WORKDIR /app

# 使用国内 npm 镜像加速
COPY package.json ./
RUN npm config set registry https://registry.npmmirror.com \
    && npm install --omit=dev

COPY . .

# 播放器库（mpegts.js / hls.js）复制到静态目录供前端使用
RUN mkdir -p public/vendor \
    && cp node_modules/mpegts.js/dist/mpegts.js public/vendor/mpegts.js \
    && cp node_modules/hls.js/dist/hls.min.js public/vendor/hls.js

EXPOSE 3010

CMD ["node", "server.js"]
