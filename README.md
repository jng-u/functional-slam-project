# Functional-SLAM

한국어 Functional-SLAM 시각화 사이트와 GPT-6 Luna 검색 API입니다.

## 로컬 실행

저장소 루트에서 정적 사이트와 API를 함께 실행합니다.

```sh
python3 api_server.py --host 127.0.0.1 --port 11017
```

`OPENAI_API_KEY` 환경 변수나 상위 프로젝트의 무시 처리된 `.secrets/openai.env`에서 API 키를 읽습니다. 페이지는 `/healthz`에서 서버 연결을 확인하고 `/api/usage`에서 한국 시간 기준 오늘 사용량을 읽습니다. 두 상태를 30초마다 갱신합니다.

## API 서버 배포

`deploy/.env.example`을 `deploy/.env`로 복사하고 호스트 이름, Pages 출처, OpenAI API 키를 설정합니다. API 호스트에 Docker Compose를 설치하고 DNS가 해당 호스트를 가리키게 합니다. TCP 80번과 443번 포트를 열고 아래 명령을 실행합니다.

```sh
cd deploy
docker compose up -d --build --wait
```

공개 주소는 `https://<LUNA_API_DOMAIN>`입니다. `GET /healthz`에서 연결을 확인하고 `GET /api/usage`에서 일일 사용량을 읽습니다. API 호스트의 `.env`와 OpenAI 키를 GitHub에 올리지 마세요.

## GitHub Pages 게시

저장소 **Settings → Pages → Build and deployment → Source**에서 **GitHub Actions**를 선택합니다. API 호스트를 준비했다면 GitHub 저장소 변수 `LUNA_API_URL`에 `https://<LUNA_API_DOMAIN>/api/query`를 저장합니다. API 주소가 아직 없다면 변수를 비워 둬도 사이트를 게시할 수 있습니다. 이때 페이지에는 백엔드 연결 안 됨과 사용량을 불러오지 못했다는 상태가 표시됩니다. API 주소를 추가한 뒤 Pages 워크플로를 다시 실행합니다.

**Actions → Deploy GitHub Pages**를 수동 실행합니다.

모든 방문자가 하루 100회의 Luna 요청을 공유합니다. 한도는 한국 시간 자정에 초기화됩니다. 상태 조회는 한도에 포함되지 않습니다.
