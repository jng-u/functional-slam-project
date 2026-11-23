# Functional-SLAM

한국어 Functional-SLAM 시각화 사이트와 GPT-6 Luna 검색 API입니다.

## 로컬 실행

저장소 루트에서 정적 사이트와 API를 함께 실행합니다.

```sh
python3 api_server.py --host 127.0.0.1 --port 11017
```

`OPENAI_API_KEY` 환경 변수나 상위 프로젝트의 무시 처리된 `.secrets/openai.env`에서 API 키를 읽습니다. 페이지는 `/healthz`에서 서버 연결을 확인하고 `/api/usage`에서 한국 시간 기준 오늘 사용량을 읽습니다. 두 상태를 30초마다 갱신합니다.

## 실험 데이터

Luna 기본 실행과 요약은 `dist/data/run.json`과 `dist/data/summary.json`에 있습니다. DeepSeek 비교 뷰(`?run=deepseek`)는 `dist/data/deepseek/`의 별도 내보내기를 읽습니다. 각 실행의 관측 경로는 `data/observations/...` 형식으로 저장되며, 뷰어가 선택한 실행 경로로 변환합니다.

`opencode-go/deepseek-v4.1-flash` 실행이 끝나면 상위 프로젝트에서 `python3 -B scripts/export_deepseek.py --run .work/run/opencode`를 실행합니다. 검증이 끝나면 `deepseek/`에 `run.json`, `graph.json`, `inference.json`, `map.bin`, `observations/`, `demo.mp4`, `summary.json`이 함께 생성됩니다.

## API 서버 배포

`deploy/.env.example`을 `deploy/.env`로 복사하고 호스트 이름, Pages 출처, OpenAI API 키를 설정합니다. AWS IAM에서 이 서버 전용 사용자를 만들고 `deploy/ROUTE53_IAM_POLICY.example.json`의 정책을 연결한 뒤 액세스 키를 발급합니다. 정책의 호스팅 영역 ID 자리표시자를 실제 ID로 바꾸세요. 키는 `deploy/.env`의 `AWS_ACCESS_KEY_ID`와 `AWS_SECRET_ACCESS_KEY`에만 넣고 저장소나 채팅에 붙여 넣지 마세요. 이 권한은 `_acme-challenge` TXT 레코드로 인증서를 발급하는 데 사용합니다.

공개 API 주소는 `https://<LUNA_API_DOMAIN>:11443`입니다. 공유기에서 외부 TCP 11080을 컴퓨터 내부 TCP 80으로, 외부 TCP 11443을 내부 TCP 443으로 전달합니다. Caddy는 Route 53 DNS 인증으로 TLS 인증서를 발급하므로 외부 80·443 포트는 필요하지 않습니다.

```sh
cd deploy
docker compose up -d --build --wait
```

공개 주소는 `https://<LUNA_API_DOMAIN>:11443`입니다. `GET /healthz`에서 연결을 확인하고 `GET /api/usage`에서 일일 사용량을 읽습니다. API 호스트의 `.env`, OpenAI 키, AWS 키를 GitHub에 올리지 마세요.

## GitHub Pages 게시

저장소 **Settings → Pages → Build and deployment → Source**에서 **GitHub Actions**를 선택합니다. API 호스트를 준비했다면 GitHub 저장소 변수 `LUNA_API_URL`에 `https://<LUNA_API_DOMAIN>:11443/api/query`를 저장합니다. API 주소가 아직 없다면 변수를 비워 둬도 사이트를 게시할 수 있습니다. 이때 페이지에는 백엔드 연결 안 됨과 사용량을 불러오지 못했다는 상태가 표시됩니다. API 주소를 추가한 뒤 Pages 워크플로를 다시 실행합니다.

`dist/`, `scripts/package-pages.mjs` 또는 Pages 워크플로를 변경해 `main`에 푸시하면 자동으로 배포됩니다. 저장소 변수만 바꿨다면 **Actions → Deploy GitHub Pages**를 수동 실행합니다.

모든 방문자가 하루 100회의 Luna 요청을 공유합니다. 한도는 한국 시간 자정에 초기화됩니다. 상태 조회는 한도에 포함되지 않습니다.
