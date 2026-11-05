# CAP 뷰어 — PASCO Capstone 파일을 휴대폰에서 보기

PASCO Capstone에서 저장한 실험 파일(`.cap`)을 **휴대폰 브라우저에서 바로 열어** 그래프·데이터 표·통계로 볼 수 있는 웹앱입니다.
설치할 프로그램이 없고, 파일은 **기기 안에서만 처리**되어 서버로 전송되지 않습니다.

> PASCO 공식 앱이 아니며 PASCO scientific과 관계가 없습니다. Capstone이 없는 환경에서 기록된 데이터를 확인하기 위한 보조 도구입니다.

## 할 수 있는 것

- **그래프**: 측정값(위치·속도·가속도 등)을 시간 또는 다른 측정값에 대해 그리기, 여러 런을 겹쳐 보기
  - 한 손가락으로 이동, 두 손가락으로 확대/축소(가로·세로 따로), 탭해서 값 읽기, 두 번 탭해서 전체 보기
  - **구간 선택** 후 그 구간만으로 통계·맞춤 계산
  - **직선 맞춤**(기울기·절편·R²), **2차 맞춤**(A·B·C·R², 위치–시간 그래프면 가속도 2A 표시)
  - 범례가 들어간 그래프 이미지(PNG) 저장
- **통계**: 런별 평균·최소·최대·표준편차·범위·데이터 수
- **표**: 런별 전체 데이터, **CSV 저장**(이 런 / 전체 런, 엑셀에서 한글이 깨지지 않도록 UTF-8 BOM 포함), 지원 기기에서는 바로 **공유**
- **정보**: Capstone 버전, 센서와 샘플링 주기, 측정값 목록, 런 목록(이름·기록 시각·길이·점 개수)
- 처음 열 때 Capstone 파일에 저장돼 있던 그래프 설정(어떤 측정값·어떤 런을 보고 있었는지)을 그대로 따라감
- **홈 화면에 추가**하면 앱처럼 실행되고 오프라인에서도 동작(PWA)
- Android에서 앱으로 설치하면 파일 앱/메신저의 **공유 → CAP 뷰어**로 바로 열기
- 라이트/다크 모드 자동 대응

아직 지원하지 않는 것: Capstone 계산기로 만든 계산 측정값, 비디오, 텍스트·이미지 등 페이지 요소.

## 사용 방법

1. 휴대폰에서 이 앱 주소(아래 *배포* 참고)를 엽니다.
2. **.cap 파일 선택**을 누르고 휴대폰에 저장된 `.cap` 파일을 고릅니다.
   - 카카오톡/드라이브로 받은 파일은 먼저 기기에 저장한 뒤 선택하세요.
3. 파일이 없으면 **예제 파일로 체험하기**로 기능을 둘러볼 수 있습니다 (경사면 수레 실험을 흉내 낸 합성 데이터).

## 배포 (GitHub Pages)

정적 파일만으로 이루어져 있어서 빌드 과정이 없습니다.

1. GitHub 저장소 **Settings → Pages**
2. **Build and deployment → Source: Deploy from a branch**
3. 브랜치(예: `main`)와 폴더 `/ (root)`를 고르고 **Save**
4. 잠시 후 `https://<사용자이름>.github.io/<저장소이름>/` 에서 열립니다.

HTTPS로 제공되어야 홈 화면 설치·오프라인·공유 기능이 동작합니다(GitHub Pages는 기본이 HTTPS).

## .cap 파일 구조 (분석 메모)

`.cap` 파일은 ZIP 압축 파일입니다.

| 경로 | 내용 |
| --- | --- |
| `main.xml` | 실험 전체 설명: 하드웨어/센서, 측정값(`DataSource`), 런 정보(`RunParameterSet`), 워크북 페이지·그래프 설정 |
| `data/Z_*.tmp` | 측정값 하나 × 런 하나의 원시 데이터 |

- 측정값마다 `<DataSource>` 아래에 런별 `<DataSet DataSetID="{런 ID}">`가 있고, 그 안의 `DependentStorageElement`가 데이터 파일(`FileName`)과 개수(`DataCacheDataSize`)를 가리킵니다.
- 데이터 파일은 **12바이트 레코드의 배열**입니다: `uint32 유효 플래그(1=유효)` + `float64 값` (리틀 엔디언). 파일은 미리 크게 잡혀 있어서 앞쪽 `DataCacheDataSize`개만 사용합니다.
- 시간 값은 보통 저장되지 않고 `IndependentStorageElement StorageType="1"`의 `IntervalCacheStartValue + i × IntervalCacheInterval`로 계산합니다. (예: 속도는 미분값이라 0.05 s부터 시작)
- 런 이름·번호·시작/끝 시각(유닉스 초)은 `RunParameterSet`의 `RunName`, `RunNumber`, `RunStartTime`, `RunStopTime`에 있습니다.
- 단위는 `BaseUnit` 코드로 저장됩니다. 확인된 코드: `256`=s, `1280`=m, `2304`=m/s, `2048`=m/s², `3330`=C, `10496`=kg. 모르는 코드는 단위를 비워 둡니다(`js/cap.js`의 `UNIT_CODES`에 추가 가능).

## 파일 구성

```
index.html              화면
css/style.css           스타일 (라이트/다크)
js/zip.js               ZIP 읽기 + inflate (DecompressionStream, 없으면 순수 JS로 대체)
js/cap.js               .cap 해석 (main.xml + 데이터 파일)
js/chart.js             터치 제스처를 지원하는 캔버스 그래프
js/app.js               화면 동작, 통계/맞춤, 표, CSV
sw.js                   오프라인 캐시 + Android 공유 받기
manifest.webmanifest    앱 설치 정보
examples/demo.cap       예제 파일 (tools/make_demo_cap.py로 생성한 합성 데이터)
tests/e2e.mjs           헤드리스 Chromium 종단 테스트
```

## 개발

```bash
# 로컬 서버 (서비스 워커·예제 파일 불러오기 때문에 file:// 대신 서버로 여세요)
python3 -m http.server 8000
# → 같은 Wi-Fi의 휴대폰에서 http://<PC IP>:8000 으로 접속해도 됩니다 (단, 설치/오프라인 기능은 HTTPS에서만)

# 예제 파일 다시 만들기
python3 tools/make_demo_cap.py examples/demo.cap

# 테스트 (Playwright 필요: npm i -D playwright && npx playwright install chromium)
node tests/e2e.mjs                    # 예제 파일로 검사
node tests/e2e.mjs 경로/내파일.cap      # 내 파일로 검사
```

앱 파일을 수정한 뒤 배포할 때는 `sw.js`의 `VERSION` 값을 바꾸면 사용자 기기의 캐시가 새 버전으로 교체됩니다.
