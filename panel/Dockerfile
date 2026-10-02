# 构建上下文是仓库根目录：docker build -f panel/Dockerfile .
FROM node:22-bookworm-slim
WORKDIR /app
COPY panel/package.json panel/package-lock.json panel/
RUN npm ci --prefix panel
# src/panel 里的代码从 /app 往上找依赖，镜像里只有 panel/node_modules
RUN ln -s panel/node_modules node_modules
COPY src/shared/panel.ts src/shared/panel.ts
COPY src/panel src/panel
COPY panel/next.config.mjs panel/postcss.config.mjs panel/tsconfig.json panel/next-env.d.ts panel/server.ts panel/
COPY panel/scripts panel/scripts
COPY panel/src panel/src
RUN npm run build --prefix panel
ENV NODE_ENV=production
ENV PANEL_HOST=0.0.0.0
ENV PANEL_PORT=38600
EXPOSE 38600
CMD ["node", "panel/scripts/start.mjs"]
