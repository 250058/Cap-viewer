# AGENTS.md — CAP 뷰어

PASCO Capstone `.cap` 파일을 휴대폰 브라우저에서 Capstone처럼 보여 주는 정적 웹앱(PWA)입니다.
배포 주소: https://cap.dshs.dev (GitHub Pages, `CNAME` 파일로 연결). 사용자 안내는 `README.md`, 파일 형식 분석은 `docs/cap-format.md`.

## 원칙

- **빌드 없음, 의존성 없음**: 바닐라 JS/CSS/HTML을 그대로 배포합니다. 번들러·프레임워크·npm 의존성을 추가하지 마세요. 예외는 `vendor/html2canvas.min.js`(1.4.1, MIT, **원본 그대로** 유지)뿐입니다.
- **파일은 기기 안에서만 처리**: `.cap` 내용을 서버·외부 서비스로 보내지 마세요. 분석 도구, 외부 폰트, CDN 요청도 넣지 않습니다(오프라인 동작 유지).
- **UI 문구는 한국어**, 코드 주석·커밋 메시지는 영어.
- **페이지(종이)는 항상 흰색**: 다크 모드에서도 Capstone 화면 부분(`.paper`)은 라이트 색을 씁니다. 바깥 크롬만 다크 대응.
- **개인 실험 데이터를 커밋하지 마세요.** 사용자가 올린 `.cap`은 저장소에 넣지 않고, 예제는 `tools/make_demo_cap.py`가 만든 합성 데이터(`examples/demo.cap`)만 씁니다.

## 구조

| 파일 | 역할 |
| --- | --- |
| `index.html` | 화면 뼈대. `<head>`의 `dshs-verify` 메타 태그는 **절대 지우거나 JS로 옮기지 마세요**(서버가 내려주는 HTML에 있어야 함) |
| `js/zip.js` | ZIP 읽기 + inflate (`DecompressionStream`, 없으면 순수 JS) |
| `js/cap.js` | `.cap` 해석: `main.xml`, 데이터 파일, 입력값, 계산식, 워크북 페이지 |
| `js/richtext.js` | Qt 서식 HTML을 **허용 목록**으로 안전하게 변환 |
| `js/util.js` | 숫자 형식, 통계/맞춤, 아이콘, 저장 도우미 |
| `js/chart.js` | 터치 제스처 캔버스 그래프 |
| `js/widgets.js` | 페이지 디스플레이(텍스트, 답 입력란, 그림, 그래프, 표, 숫자) |
| `js/pdf.js` | PDF 작성(JPEG 페이지 + 책갈피) |
| `js/app.js` | 화면 틀: 페이지 탭, 보기 방식, 데이터 요약, 런 선택, CSV, PDF, 기록(history) |
| `sw.js` | 오프라인 캐시, Android 공유 받기 |
| `tests/e2e.mjs` | Playwright(헤드리스 Chromium) 종단 테스트 |
| `tools/` | 예제 파일·아이콘 생성 스크립트 |

## 반드시 지킬 것

1. **`sw.js`**: 앱 파일을 고치면 `VERSION`을 올리고, 새 파일을 추가하면 `SHELL` 목록에도 넣으세요. 안 그러면 설치된 앱이 옛 버전을 보여 줍니다.
2. **보안**: 파일에서 온 텍스트는 `innerHTML`에 직접 넣지 말고 `esc()` 또는 `CapRichText.render()`를 거칩니다. `.cap` 안의 SVG는 렌더하지 않습니다(`loadImage`가 거부).
3. **`hidden` 속성**: CSS에서 `display`를 지정한 요소도 숨겨지도록 `[hidden] { display: none !important; }`가 있습니다. 지우지 마세요.
4. **뒤로 가기**: 파일을 열면 주소가 `#파일이름`이 되고, 뒤로 가기는 시작 화면입니다. 팝업·시트·전체 화면은 `openOverlay()`/`closeOverlay()`로 열어 기록에 올립니다(직접 `history`를 만지지 마세요).
5. **위젯 메서드 이름**: 그래프 위젯이 이미 `fit`(곡선 맞춤 설정) 속성을 갖고 있어서, 새 메서드는 이와 겹치지 않게 지으세요(예: `fitToBox`).
6. **테이블·그래프 숫자**: 값은 파일에 저장된 기본 단위로 들어 있고, 표시할 때 `P.unitFor()`의 `scale`로 바꿉니다.
7. 모르는 단위 코드는 비워 둡니다. 새 코드는 `js/cap.js`의 `UNITS`와 `docs/cap-format.md`에 함께 추가하세요.

## 테스트

```bash
# Playwright 필요 (npm i -D playwright && npx playwright install chromium; 전역 설치면 NODE_PATH 지정)
NODE_PATH=$(npm root -g) node tests/e2e.mjs                  # 예제 파일 전체 기능 + PDF + 뒤로 가기 + 보안 필터
NODE_PATH=$(npm root -g) node tests/e2e.mjs 내파일.cap        # 파일의 모든 페이지를 휴대폰/PC 폭으로 열어 오류 검사
for f in js/*.js sw.js; do node --check $f; done             # 문법 검사
python3 -m http.server 8000                                   # 로컬 실행 (file:// 은 서비스 워커가 안 됨)
```

화면을 바꿨다면 스크린샷(휴대폰 390px, PC 1280px)으로 직접 확인하세요. `docs/screenshots/`와 아이콘을 바꿀 때는 `node tools/render-icons.mjs`, 예제 파일은 `python3 tools/make_demo_cap.py examples/demo.cap`.

## 배포와 git

- GitHub Pages가 브랜치 `ccr-560522f0-95nsd6`의 루트를 배포합니다. push하면 1분 안에 https://cap.dshs.dev 에 반영됩니다.
- **`CNAME`(`cap.dshs.dev`)은 건드리지 마세요.** 사용자가 GitHub 웹에서 직접 커밋하기도 하므로, push가 거절되면 `git fetch` → `git rebase origin/<브랜치>` 후 다시 push합니다(강제 push 금지).
- 요청이 없으면 PR을 만들지 않습니다. 커밋은 작게, 이유를 적습니다.
- 배포 확인: `curl https://cap.dshs.dev/` 로 받은 HTML·JS가 저장소와 같은지 비교합니다(브라우저 캐시/서비스 워커 때문에 화면은 늦게 바뀔 수 있음).
