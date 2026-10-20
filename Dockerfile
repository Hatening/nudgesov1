# RelayDesk (nudgeso) — zero-dependency Node server
# 与仓库实际结构匹配：package.json + server.js + public/，无任何 npm 依赖
FROM node:24-alpine

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3030 \
    DATA_DIR=/data

# 无运行时依赖：不需要 npm install / package-lock.json
COPY package.json ./
COPY --chown=node:node server.js ./
COPY --chown=node:node public ./public

RUN mkdir -p /data && chown -R node:node /app /data

USER node

# 注意：Render 免费实例没有持久磁盘，重新部署后 /data 会重置。
# 若要持久化，在 Render 挂载 Disk 到 /data，并把上面的 USER node 去掉（磁盘默认属 root）。
VOLUME ["/data"]

EXPOSE 3030

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3030)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
