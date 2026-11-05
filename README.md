# CAP 뷰어 — PASCO Capstone 파일을 휴대폰에서 보기

PASCO Capstone에서 저장한 실험 파일(`.cap`)을 **휴대폰 브라우저에서 바로 열어** 그래프·데이터 표·통계로 볼 수 있는 웹앱입니다.
설치할 프로그램이 없고, 파일은 **기기 안에서만 처리**되어 서버로 전송되지 않습니다.

> PASCO 공식 앱이 아니며 PASCO scientific과 관계가 없습니다. Capstone이 없는 환경에서 기록된 데이터를 확인하기 위한 보조 도구입니다.

## 할 수 있는 것

**Capstone 화면처럼 보기**
- 위쪽 **페이지 탭**과 아래 **◀ ▶** 버튼으로 Capstone 워크북 페이지를 넘겨 봅니다.
- 페이지에 있는 **설명문(서식 있는 텍스트)**, **그림**, **답 입력란(Text Entry)**, **그래프**, **표**, **디지털 표시(Digits)** 를 그대로 보여 줍니다.
- 보기 방식 두 가지 (아래 오른쪽 버튼으로 전환, 선택은 기억됨)
  - **세로 보기**: 휴대폰 화면에 맞게 디스플레이를 읽는 순서대로 세로로 정리 (휴대폰 기본값)
  - **원본 배치**: Capstone에서 배치한 위치·크기 그대로 페이지를 축소해 보여 주고 확대/축소 가능 (넓은 화면 기본값)
- 아래 **데이터 요약**: 측정값별 런 목록, 런 목록(기록 시각·길이·점 개수), 센서, 파일 정보, 런별 전체 데이터 표와 CSV 저장

**그래프 (Capstone 그래프 도구 모음과 비슷하게)**
- 축 이름(예: `Position (m) ▾`)을 눌러 측정값 바꾸기, 런 선택, 데이터에 맞게 보기
- 한 손가락으로 이동, 두 손가락으로 확대/축소(가로·세로 따로), 탭해서 좌표 읽기, 두 번 탭해서 전체 보기
- **구간 선택**, **곡선 맞춤**(직선: 기울기·절편·R², 2차: A·B·C·R², 위치–시간이면 가속도 2A), **Σ 통계**(평균·최소·최대·표준편차·개수)
- 점/선 표시 전환, 그래프 이미지(PNG) 저장, **크게 보기**(전체 화면, 휴대폰 뒤로 가기로 닫힘)
- Capstone에 저장된 설정(측정값, 표시 중인 런, 점/선, 직선 맞춤, 표시 단위)을 따라 처음 화면을 구성

**표·숫자**
- Capstone 표처럼 열마다 런 선택과 측정값(단위) 머리글, 행 번호, 열별 CSV 저장
- 표에 **직접 입력한 값**과 **계산기 계산값**(사칙연산·거듭제곱·단위 변환으로 된 식)도 표시
- 표시 단위 변환 지원 (예: V→mV, A→mA)

**기타**
- **홈 화면에 추가**하면 앱처럼 실행되고 오프라인에서도 동작(PWA), Android에서는 **공유 → CAP 뷰어**로 바로 열기
- 라이트/다크 모드 (페이지는 Capstone처럼 항상 흰 종이)

아직 지원하지 않는 것: 미터·오실로스코프·FFT·동영상 같은 일부 디스플레이(자리 표시만), 함수(sin, sqrt 등)가 들어간 계산식, 일부 단위 코드(자기장 센서의 기본 단위 등).

## 사용 방법

1. 휴대폰에서 이 앱 주소(아래 *배포* 참고)를 엽니다.
2. **.cap 파일 선택**을 누르고 휴대폰에 저장된 `.cap` 파일을 고릅니다.
   - 카카오톡/드라이브로 받은 파일은 먼저 기기에 저장한 뒤 선택하세요.
3. 파일이 없으면 **예제 파일로 체험하기**로 기능을 둘러볼 수 있습니다 (경사면 수레 실험을 흉내 낸 합성 데이터: 안내 페이지 + 데이터 분석 페이지).

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
| `images/*.png` | 페이지에 넣은 그림 (그림 디스플레이의 `Snapshot FileName`) |

- 측정값마다 `<DataSource>` 아래에 런별 `<DataSet DataSetID="{런 ID}">`가 있고, 그 안의 `DependentStorageElement`가 데이터 파일(`FileName`)과 개수(`DataCacheDataSize`)를 가리킵니다.
- 데이터 파일은 **12바이트 레코드의 배열**입니다: `uint32 유효 플래그(1=유효)` + `float64 값` (리틀 엔디언). 파일은 미리 크게 잡혀 있어서 앞쪽 `DataCacheDataSize`개만 사용합니다.
- 시간 값은 보통 저장되지 않고 `IndependentStorageElement StorageType="1"`의 `IntervalCacheStartValue + i × IntervalCacheInterval`로 계산합니다. (예: 속도는 미분값이라 0.05 s부터 시작)
- 런 이름·번호·시작/끝 시각(유닉스 초)은 `RunParameterSet`의 `RunName`, `RunNumber`, `RunStartTime`, `RunStopTime`에 있습니다.
- 표에 직접 입력한 값은 `StorageType="7"`이며, 레코드가 `uint32 형식(2=문자열, 0=빈칸)` + `uint32 바이트 수` + `UTF-16LE 문자열`입니다. 행 번호 기반(`IndependentStorageElement StorageType="4"`)이고 데이터 세트 이름(`DataSet Name`, 예: "Set")을 가집니다.
- 계산기 식은 `CalculationManager/Expression/ASTNode` 트리입니다. 확인된 노드 형식: 1=숫자, 3=측정값 참조, 4=단위 변환, 5=더하기, 6=빼기, 9=곱하기, 14=거듭제곱, 27=대입.
- 워크북: `Workbook/WorkbookPage`(이름, `PageSize`) 안의 `WorkbookItem`이 디스플레이입니다. `GUID`가 종류(`CSTextEdit` 텍스트, `CSTextEntry` 답 입력란, `CSImageAnalysis` 그림, `CSLineGraph` 그래프, `CSDataTable` 표, `CSDataDigits` 숫자), `Position`/`Size`가 페이지에 대한 비율(0~1), `ZValue`가 쌓임 순서, `DisplayTitle`이 제목입니다. 텍스트는 Qt 서식 HTML(`HTML` 속성)로 저장됩니다.
- 디스플레이의 `BundleInput`은 측정값(`BundleMeasID`), 런(`BundleDataSetID`, 0이면 최신 런), 표시 단위(`DataAdapter ConverterConverterUnit`)를 가리킵니다.
- 단위는 `BaseUnit` 코드로 저장됩니다. 확인된 코드: `256`=s, `1024`=V, `1025`=mV, `1280`=m, `1794`=T, `2048`=m/s², `2304`=m/s, `3330`=C, `3584`=A, `3585`=mA, `10496`=kg. (상위 바이트가 같은 코드끼리 같은 물리량입니다.) 모르는 코드는 단위를 비워 둡니다(`js/cap.js`의 `UNIT_CODES`에 추가 가능).

## 파일 구성

```
index.html              화면
css/style.css           스타일 (라이트/다크)
js/zip.js               ZIP 읽기 + inflate (DecompressionStream, 없으면 순수 JS로 대체)
js/cap.js               .cap 해석 (main.xml, 데이터 파일, 입력값, 계산식, 워크북 페이지)
js/richtext.js          Capstone(Qt) 서식 텍스트를 안전하게 HTML로 변환 (허용 목록 방식)
js/util.js              숫자 형식, 통계/맞춤, 아이콘 등 공통 함수
js/chart.js             터치 제스처를 지원하는 캔버스 그래프
js/widgets.js           페이지 디스플레이: 텍스트, 답 입력란, 그림, 그래프, 표, 숫자
js/app.js               화면 틀: 페이지 탭, 보기 방식, 데이터 요약, 런 선택, CSV
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
node tests/e2e.mjs                    # 예제 파일로 기능 검사 (페이지, 텍스트, 그림, 그래프, 표, 보안 필터 등)
node tests/e2e.mjs 경로/내파일.cap      # 내 파일의 모든 페이지를 휴대폰/PC 폭으로 열어 오류 검사
```

앱 파일을 수정한 뒤 배포할 때는 `sw.js`의 `VERSION` 값을 바꾸면 사용자 기기의 캐시가 새 버전으로 교체됩니다.
