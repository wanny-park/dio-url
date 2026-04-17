# dio-url — URL 단축 서비스

Cloudflare Workers + KV 기반 무료 URL 단축 서비스 + 크롬 사이드패널 확장

---

## 빠른 배포

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/wanny-park/dio-url)

1. 위 버튼 클릭
2. Cloudflare 로그인 → Deploy
3. 생성된 Worker URL 복사
4. 크롬 확장 설치 → 사이드패널에서 URL 붙여넣기

---

## 크롬 확장 설치

1. `chrome-extension/` 폴더 다운로드
2. `chrome://extensions/` → 개발자 모드 ON
3. **압축 해제된 확장 프로그램 로드** → `chrome-extension/` 선택
4. 브라우저 우측 사이드패널 아이콘 클릭 → 온보딩 시작

---

## 기능

- 🔗 현재 페이지 URL 1클릭 단축
- ✏️ 커스텀 별칭 지정
- 📊 클릭 수 통계
- 📢 광고 스플래시 페이지 (ON/OFF + 카운트다운 설정)
- 💰 애드센스 코드 삽입
- 🌐 커스텀 도메인 지원

---

## 비용

**$0** — Cloudflare Workers 무료 티어 (요청 10만/일)
