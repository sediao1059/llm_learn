#!/usr/bin/env bash
# llm_learn 一键部署脚本
# 用法：./deploy.sh back|front|all
#   back  : rsync 后端源码到服务器 → 服务器容器内安装依赖/构建/同步库表 → 重启运行容器
#   front : 本地构建前端 → rsync dist 静态资源到服务器
#   all   : back + front
#
# 服务器：root@139.196.151.20 部署目录 /usr/local/llm_learn，站点 http://llm.fixbug.fun（nginx 反代 /api）。
# 服务器是 CentOS 7（glibc 2.17，原生跑不了 Node 18+/Prisma 6），构建与运行都在 Docker 容器里（node:20-bullseye-slim：glibc 2.31 不用 clone3 系统调用，兼容老 Docker 的 seccomp；自带 libssl1.1 匹配 Prisma 默认引擎）；
# 服务器上的老 Docker 1.13 拉不动新镜像，镜像由本脚本在缺失时自动「本地构建 → save → ssh load」导入
# （本机为 Apple Silicon/Docker Desktop 时 amd64 容器走 qemu 模拟，只用于 apt 装包，不在本地跑 node 构建）。
# 前置条件：本机已配好 SSH 公钥免密登录服务器；服务器 backend/.env 已就位（首次部署人工创建）。
set -euo pipefail

SERVER="root@139.196.151.20"
REMOTE_DIR="/usr/local/llm_learn"
BACKEND_PORT=9100
IMAGE="node:20-bullseye-slim"
CONTAINER="llm-learn-backend"
NETWORK="llm-net"
NPM_REGISTRY="https://registry.npmmirror.com"
ROOT="$(cd "$(dirname "$0")" && pwd)"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

ensure_server_image() {
  if ssh "$SERVER" "docker images --format '{{.Repository}}:{{.Tag}}' | grep -qx '$IMAGE'"; then
    say "服务器镜像 ${IMAGE} 已存在"
    return
  fi
  docker image inspect "$IMAGE" >/dev/null 2>&1 || docker pull --platform linux/amd64 "$IMAGE"
  say "导入运行镜像 ${IMAGE} 到服务器（首次约 1-3 分钟）"
  docker save "$IMAGE" | gzip | ssh "$SERVER" 'gzip -d | docker load'
}

push_backend() {
  say "同步后端源码到服务器"
  ssh "$SERVER" "mkdir -p $REMOTE_DIR/backend"
  rsync -a --delete --exclude node_modules --exclude dist --exclude .env "$ROOT/backend/" "$SERVER:$REMOTE_DIR/backend/"
}

remote_backend() {
  say "服务器端：安装依赖 → 构建 → 同步表结构（db push 幂等）→ 重启后端容器"
  ssh "$SERVER" REMOTE_DIR="$REMOTE_DIR" IMAGE="$IMAGE" CONTAINER="$CONTAINER" NETWORK="$NETWORK" BACKEND_PORT="$BACKEND_PORT" NPM_REGISTRY="$NPM_REGISTRY" bash -s <<'EOF'
set -e
cd "$REMOTE_DIR/backend"
[ -f .env ] || { echo "✖ 缺少 $REMOTE_DIR/backend/.env（首次部署请手工创建，至少含 DATABASE_URL / JWT_SECRET / PORT）"; exit 1; }
docker network create "$NETWORK" 2>/dev/null || true
docker network connect "$NETWORK" mysql 2>/dev/null || true
BUILD="docker run --rm --network $NETWORK --env-file .env -v $REMOTE_DIR/backend:/app -w /app -e NPM_CONFIG_REGISTRY=$NPM_REGISTRY -e PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma $IMAGE"
$BUILD bash -c 'npm install --no-audit --no-fund && npx prisma generate && npx prisma db push --skip-generate && npx nest build'
docker rm -f "$CONTAINER" 2>/dev/null || true
docker run -d --name "$CONTAINER" --restart unless-stopped --network "$NETWORK" -p 127.0.0.1:$BACKEND_PORT:$BACKEND_PORT --env-file .env -v "$REMOTE_DIR/backend:/app" -w /app "$IMAGE" node dist/main.js
ok=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$BACKEND_PORT/api || true)"
  [ -n "$code" ] && [ "$code" != "000" ] && { ok=1; break; }
  sleep 1
done
docker logs --tail 5 "$CONTAINER"
[ -n "$ok" ] || { echo "✖ 后端容器未响应 http://127.0.0.1:$BACKEND_PORT/api，完整日志：docker logs $CONTAINER"; exit 1; }
EOF
}

deploy_back() { ensure_server_image; push_backend; remote_backend; }

deploy_front() {
  say "本地构建前端"
  (cd "$ROOT/frontend" && npm run build)
  say "同步前端静态资源到服务器"
  ssh "$SERVER" "mkdir -p $REMOTE_DIR/frontend"
  rsync -a --delete "$ROOT/frontend/dist/" "$SERVER:$REMOTE_DIR/frontend/"
}

case "${1:-}" in
  back) deploy_back ;;
  front) deploy_front ;;
  all) deploy_back; deploy_front ;;
  *) echo "用法：./deploy.sh back|front|all"; exit 1 ;;
esac
say "部署完成 ✔"
