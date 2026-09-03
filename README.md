# 도쿄 3박 4일 · 2026.10.08 – 10.11

`index.html` 하나로 도는 정적 페이지입니다. 왼쪽에 4일치 일정(이동수단·소요시간·금액 포함), 오른쪽에 구글 지도가 뜹니다.

## 로컬에서 보기

```
python -m http.server 8000
```
→ http://localhost:8000

`file://` 로 더블클릭해서 열어도 일정 사이드바는 정상 동작합니다. 다만 지도 키에 리퍼러 제한을 걸면 `file://` 에서는 통하지 않으니, 지도까지 쓰려면 위 로컬 서버로 여세요.

## 도커로 배포 (CentOS 서버 기준)

호스트 80번을 다른 컨테이너가 쓰고 있어도 상관없습니다. 8080으로 띄웁니다.

```bash
sudo yum install -y git            # CentOS 8+ 면 dnf
sudo mkdir -p /var/www && cd /var/www
sudo git clone https://github.com/pyb8527/tokyo-trip.git
cd tokyo-trip

sudo docker compose up -d --build   # 구버전이면 docker-compose up -d --build

sudo firewall-cmd --permanent --add-port=8080/tcp
sudo firewall-cmd --reload

curl -I http://127.0.0.1:8080/
```

→ `http://서버IP:8080/`

**일정 수정 후 재배포**
```bash
cd /var/www/tokyo-trip
sudo git pull
sudo docker compose up -d --build
```

**로그 · 상태 · 중지**
```bash
sudo docker compose logs -f
sudo docker compose ps
sudo docker compose down
```

### 지도 키를 서버에 둘 경우 (선택)

기본값은 "서버에 키를 두지 않음"입니다. 접속하면 키 입력창이 뜨고 한 번 넣으면 브라우저에 저장됩니다.

서버에 두고 싶으면:

```bash
cp gmaps-key.local.js.example gmaps-key.local.js
vi gmaps-key.local.js        # KEY 값만 교체
```

그리고 `docker-compose.yml` 의 `volumes:` 두 줄 주석을 해제한 뒤 `docker compose up -d`.

> ⚠️ CentOS는 SELinux 때문에 볼륨 마운트에 **`:ro,Z`** 가 반드시 필요합니다. 빼면 컨테이너가 파일을 못 읽어 403이 납니다. compose 파일에 이미 들어가 있습니다.

`gmaps-key.local.js` 는 `.gitignore` + `.dockerignore` 양쪽에 걸려 있어 깃헙에도, 이미지에도 들어가지 않습니다.

### Cloudflare 터널로 서브도메인 붙이기 (권장)

포트를 하나도 열지 않고 `https://tokyo.도메인` 으로 띄웁니다. HTTPS가 자동으로 붙어서 **모바일 크롬의 HTTPS 자동 업그레이드 문제도 같이 해결**됩니다.

**1. Cloudflare Zero Trust 대시보드에서 터널 생성**

`one.dash.cloudflare.com` → **Networks → Tunnels → Create a tunnel** → **Cloudflared** 선택 → 이름 입력(예: `tokyo-trip`)

설치 방법 화면에 나오는 **토큰**(`eyJhIjoi...` 로 시작하는 긴 문자열)만 복사하세요. 거기 적힌 설치 명령은 실행하지 않아도 됩니다 — 아래에서 컨테이너로 띄웁니다.

**2. 서버에 토큰 넣기**

```bash
cd /var/www/tokyo-trip
git pull
cp .env.example .env
vi .env                       # TUNNEL_TOKEN= 뒤에 토큰 붙여넣기
```

**3. 터널 실행**

```bash
sudo docker compose --profile tunnel up -d
sudo docker compose logs -f cloudflared     # "Registered tunnel connection" 나오면 성공
```

**4. 대시보드에서 공개 호스트명 연결**

터널 설정 → **Public Hostname → Add a public hostname**

| 항목 | 값 |
|---|---|
| Subdomain | `tokyo` |
| Domain | `내도메인` |
| Type | `HTTP` |
| URL | `tokyo-trip:80` |

`tokyo-trip` 은 같은 도커 네트워크에 있는 컨테이너 이름이라 그대로 쓰면 됩니다. DNS 레코드는 Cloudflare가 자동으로 만듭니다.

→ `https://tokyo.내도메인`

**5. 포트 닫기 (선택)**

터널이 잘 뜨면 `docker-compose.yml` 의 `ports:` 두 줄을 지우고 `docker compose up -d`. 그러면 서버에 열린 포트가 0이 됩니다.

**6. Maps 키 리퍼러 교체**

```
https://tokyo.내도메인
```
와일드카드(`/*`)나 끝의 `/` 없이 **출처만** 넣으세요. 호스트만 적으면 하위 경로가 자동으로 허용됩니다.

> ⚠️ `.env` 의 터널 토큰은 자격증명입니다. `.gitignore` 에 걸어뒀으니 절대 커밋하지 마세요.

**터널 끄기**
```bash
sudo docker compose --profile tunnel down
```

### 리버스 프록시 뒤에 둘 경우

80번 컨테이너가 traefik / nginx-proxy 같은 리버스 프록시라면, `docker-compose.yml` 의 포트를 `"127.0.0.1:8080:80"` 으로 바꿔 외부 노출을 막고 프록시에서 라우팅하세요. 그러면 방화벽도 열 필요 없고 HTTPS도 프록시가 처리합니다.

## 내 서버에 올리기

정적 파일이라 빌드·백엔드가 필요 없습니다. 웹 루트에 아래 2개만 올리면 끝입니다.

```
index.html
gmaps-key.local.js
```

⚠️ **배포 방식 주의**
- **FTP / scp 직접 업로드** → `.gitignore` 는 git 전용이라 무관합니다. 두 파일 다 올리면 됩니다
- **git push 로 배포** (액션·서버에서 pull) → `gmaps-key.local.js` 는 gitignore 때문에 **안 따라갑니다.** `.gitignore` 에서 그 줄을 지우고 커밋하거나, 서버에만 따로 올려두세요

키 파일을 아예 올리지 않아도 됩니다. 그 경우 접속 시 키 입력창이 뜨고, 한 번 넣으면 브라우저 `localStorage` 에 저장됩니다 (본인 브라우저에서만 지도가 보임).

배포 후 Google Cloud Console 의 **애플리케이션 제한 → 웹사이트**에 실제 주소를 프로토콜까지 정확히 추가하세요:
```
https://내도메인/*
```

## 깃헙 페이지 배포

1. 이 폴더를 깃헙 저장소로 올립니다
2. Settings → Pages → Source: `Deploy from a branch` → `main` / `(root)`
3. `https://<계정>.github.io/<저장소>/` 로 접속

`index.html` 이라 별도 설정 없이 바로 잡힙니다.

## 지도 키

### 지금 구조
- 키는 `gmaps-key.local.js` **한 파일에만** 들어갑니다. `index.html` 에는 키가 없습니다
- 이 파일은 `.gitignore` 에 걸려 있어 **깃헙에 올라가지 않습니다**
- 따라서 **로컬**에서는 지도가 자동으로 뜨고, **깃헙 페이지**에서는 키 입력창이 뜹니다. 거기에 키를 한 번 붙여넣으면 브라우저 `localStorage` 에 저장돼서 다음부터는 안 물어봅니다

### 먼저 알아둘 것
브라우저용 Maps JavaScript 키는 **숨길 수 있는 비밀이 아닙니다.** 어디에 넣든 개발자도구 네트워크 탭에 그대로 보입니다. 그래서 보호 방식이 "감추기"가 아니라 **"훔쳐 가도 못 쓰게 막기"** 입니다. 아래 세 가지를 거세요.

**1. 애플리케이션 제한 → 웹사이트**
Google Cloud Console → API 및 서비스 → 사용자 인증 정보 → 해당 키

허용 목록:
```
https://<계정>.github.io/<저장소>/*
http://localhost:8000/*
http://127.0.0.1:8000/*
```

**2. API 제한 → 키 제한**
`Maps JavaScript API` **하나만** 체크. 다른 API가 열려 있으면 키가 새어 나갔을 때 피해가 커집니다.

**3. 할당량·예산 상한** ← 금전 피해를 막는 진짜 안전장치
- API 및 서비스 → 할당량 → Maps JavaScript API 일일 요청 수를 **1,000건** 정도로 제한
- 결제 → 예산 및 알림 → 월 예산 **$1** + 알림

1·2번만 제대로 걸면 키가 노출돼도 남이 쓸 수 없고, 3번이 최후의 방어선입니다.

### 링크 공유하면서 지도도 같이 보여주고 싶다면
`.gitignore` 에서 `gmaps-key.local.js` 줄을 지우고 커밋하면 됩니다. 대신 **위 1·2·3번 제한을 반드시 먼저 걸어 두세요.** 공개 저장소의 키는 봇이 몇 분 안에 긁어 갑니다. 리퍼러 제한이 걸려 있으면 긁어 가도 쓰지 못합니다.

### 키가 샌 것 같으면
콘솔에서 해당 키 삭제 → 새 키 발급 → `gmaps-key.local.js` 값만 교체. 재발급이 가장 빠르고 확실합니다.

## 기능

| 기능 | 설명 |
|---|---|
| **오프라인** | 서비스 워커로 일정 전체를 캐시합니다. 데이터가 끊겨도 일정·시간·금액·주의사항이 그대로 보입니다. **지도만 비어 있습니다** (구글 지도 타일은 캐시 불가) |
| **홈 화면 추가** | PWA. 안드로이드 크롬 "앱 설치", iOS 사파리 "홈 화면에 추가" |
| **길찾기** | 이전 장소를 출발지로, 그 구간의 이동수단(도보/전철)을 그대로 넘겨 구글 지도가 실제 환승 경로를 바로 띄웁니다 |
| **지금** | 여행 당일이면 현재 시각에 해당하는 일정을 하이라이트하고, 칩을 누르면 그리로 이동합니다. 여행 전에는 D-day 를 표시합니다 |
| **방문 체크** | 카드 우상단 동그라미. 진행률이 헤더에 쌓입니다 (브라우저에 저장) |
| **내 위치** | 지도 HUD 버튼. 파란 점 + 정확도 원 |
| **딥링크** | `#day2`, `#d1-p4` 로 특정 날짜·장소를 바로 엽니다. 북마크·공유 가능 |
| **목록 접기** | 지도 HUD 버튼 또는 **M** 키. 지도가 화면 전체를 씁니다 |
| **가계부** | `expenses.html` — 계획 예산 대비 실제 지출, 일자별·분류별 집계, 원화 환산, JSON 내보내기 |

핀을 누르면 지도 하단에 작은 카드가 뜹니다. 닫기 버튼 · **Esc** · 지도 빈 곳 클릭으로 닫힙니다.

### 서비스 워커 갱신

일정을 고쳐 배포한 뒤 브라우저가 옛 버전을 붙들고 있으면 `sw.js` 의 `CACHE` 뒤 숫자를 올리세요.
HTML 은 네트워크 우선이라 온라인이면 대개 자동으로 최신을 받습니다.

## 일정 고치기

`index.html` 안 `const TRIP_DATA = { ... }` 객체만 고치면 사이드바·지도·거리·예산이 전부 따라 바뀝니다.

```js
{
  name:"장소명", en:"English", lat:35.6595, lng:139.7005,
  cat:"분류", time:"14:20", cost:"¥1,200",   // cost 가 "무료" 면 초록 뱃지
  note:"설명. <b>강조</b> 와 <br> 줄바꿈을 쓸 수 있습니다",
  radius:300,        // 도보 반경 원(m), 기본 300
  fit:false,         // 범위 맞춤 계산에서 제외 (공항처럼 먼 곳)
  move:{ mode:"train", min:27, via:"긴자선 시부야 → 칸다", cost:"IC ¥210" }
}
```

- `move.mode` : `walk` / `train` / `bus` / `car`
- `day.budget` : 날짜 헤더 오른쪽에 뜨는 하루 예산 문자열
- `day.flight` : 그날 항공편 배너 `{ from, to, dep, arr }`
