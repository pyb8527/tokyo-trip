# 도쿄 여행 일정표 · 정적 페이지 (PWA)
# 빌드:  docker build -t tokyo-trip .
# 실행:  docker run -d --name tokyo-trip --restart unless-stopped -p 8080:80 tokyo-trip

FROM nginx:alpine

RUN rm -rf /usr/share/nginx/html/*

COPY index.html expenses.html manifest.webmanifest sw.js /usr/share/nginx/html/
COPY icons/ /usr/share/nginx/html/icons/

# 키 자리표시자. 값이 PASTE_ 로 시작하면 null 을 넣도록 되어 있어
# 정상적인 키 입력창이 뜨고, 콘솔에 404 도 남지 않는다.
# 실제 키는 compose 의 volumes 로 이 파일을 덮어쓰면 된다.
COPY gmaps-key.local.js.example /usr/share/nginx/html/gmaps-key.local.js

COPY docker/default.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO /dev/null http://127.0.0.1/ || exit 1
