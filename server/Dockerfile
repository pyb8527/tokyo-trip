# 도쿄 여행 API — 의존성이 없어 빌드 단계가 필요 없습니다.
# node:sqlite 를 쓰므로 네이티브 모듈 컴파일도 없습니다 (Node 22.5+ 내장).
FROM node:24-alpine

RUN apk add --no-cache wget

WORKDIR /app

COPY server/package.json ./
COPY server/src ./src

# seed 가 읽을 원본 일정. 컨테이너 안에서 /app/index.html 로 찾습니다.
COPY index.html ./index.html

# DB 파일이 놓일 자리. compose 에서 볼륨으로 덮어씁니다.
RUN mkdir -p /app/data && chown -R node:node /app

USER node
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0 DB_PATH=/app/data/trip.db

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO /dev/null http://127.0.0.1:8787/api/health || exit 1

CMD ["node", "src/index.js"]
