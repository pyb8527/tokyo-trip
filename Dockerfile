# 도쿄 여행 일정표 · 정적 페이지
# 빌드:  docker build -t tokyo-trip .
# 실행:  docker run -d --name tokyo-trip --restart unless-stopped -p 8080:80 tokyo-trip

FROM nginx:alpine

# 기본 페이지 제거 후 일정표만 복사
# gmaps-key.local.js 는 .dockerignore 로 제외됩니다 — API 키를 이미지에 굽지 않기 위함
RUN rm -rf /usr/share/nginx/html/*
COPY index.html /usr/share/nginx/html/

# gzip·캐시 설정
COPY docker/default.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO /dev/null http://127.0.0.1/ || exit 1
