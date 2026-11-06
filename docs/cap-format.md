# .cap 파일 구조 (분석 메모)

CAP 뷰어를 만들면서 실제 Capstone 파일(2.14.6, 2.6.1 버전으로 저장된 파일)을 분석해 확인한 내용입니다.
PASCO의 공식 문서가 아니므로, 다른 버전의 파일에서는 다를 수 있습니다.

## 컨테이너

`.cap` 파일은 ZIP 압축 파일입니다.

| 경로 | 내용 |
| --- | --- |
| `main.xml` | 실험 전체 설명: 하드웨어/센서, 측정값(`DataSource`), 런 정보(`RunParameterSet`), 계산식, 워크북 페이지·디스플레이 설정 |
| `data/Z_*.tmp` | 측정값 하나 × 런(또는 데이터 세트) 하나의 원시 데이터 |
| `images/*.png` | 페이지에 넣은 그림 (그림 디스플레이의 `Snapshot FileName`, 경로 구분자는 `\`) |

## 측정 데이터

- 측정값마다 `<DataSource>` 아래에 런별 `<DataSet DataSetID="{런 ID}">`가 있고, 그 안의 `DataSegmentElement/DependentStorageElement`가 데이터 파일(`FileName`)과 개수(`DataCacheDataSize`)를 가리킵니다.
- **센서 데이터** (`StorageType="0"`): **12바이트 레코드의 배열**입니다. `uint32 플래그` + `float64 값` (리틀 엔디언). 플래그의 맨 아래 비트가 1이면 유효한 값입니다. 위쪽 비트가 함께 켜진 경우도 있습니다(예: 수동 기록(Keep) 파일의 한 점이 `0x00020001`). 그 뜻은 아직 모르지만 값은 정상이었습니다. 파일은 미리 크게 잡혀 있어서 앞쪽 `DataCacheDataSize`개만 사용합니다.
- **독립 변수가 파일로 저장된 경우** (`IndependentStorageElement`에 `FileName`, `StorageType="0"`): 시간 대신 기록 시각 등이 같은 12바이트 형식으로 들어 있습니다. 수동 기록(Keep) 파일에서 나옵니다.
- **표에 직접 입력한 값** (`StorageType="7"`): 레코드가 `uint32 형식(2=문자열, 0=빈칸)` + `uint32 바이트 수` + `UTF-16LE 문자열`입니다. 행 번호 기반이고(`IndependentStorageElement StorageType="4"`), 데이터 세트 이름(`DataSet Name`, 예: "Set")을 가집니다.
- **시간 값**은 보통 저장되지 않고 `IndependentStorageElement StorageType="1"`의 `IntervalCacheStartValue + i × IntervalCacheInterval`로 계산합니다. (예: 속도는 위치의 미분값이라 0.05 s부터 시작)
- 값은 측정값의 기본 단위(`BaseUnit`)로 저장됩니다.

## 런

- `RunParameters/RunParameterGroup/RunParameterSet`의 `RunParameterID`가 `DataSetID`와 같습니다.
- 런 이름·번호·시작/끝 시각(유닉스 초): `RunName`, `RunNumber`, `RunStartTime`, `RunStopTime`. 이름이 비어 있으면 Capstone은 "Run #번호"로 표시합니다.
- `RunNumber="4294967294"`, `RunName="Auto"`인 항목은 데이터가 없는 자리 표시입니다.

## 계산식 (Capstone 계산기)

`CalculationManager/Container/Expression/ASTNode` 트리이며, 맨 위 노드(`Type="27"`, 대입)의 `EUID`가 계산 측정값(`DataSource DataMeasSourceType="1007"`)과 같습니다.

| `Type` | 의미 | 비고 |
| --- | --- | --- |
| 1 | 숫자 | `Value` |
| 3 | 측정값 참조 | `EUID`, `Name` |
| 4 | 단위 변환 | 참조 노드의 자식, 바꿀 단위 `BaseUnit` |
| 5 | 더하기 | |
| 6 | 빼기 | |
| 9 | 곱하기 | |
| 14 | 거듭제곱 | |
| 27 | 대입 | `Name` = 계산 측정값 이름 |

다른 형식(나누기, 함수 등)은 아직 확인하지 못했습니다.

## 워크북 페이지

- `Workbook/WorkbookPage`: 페이지 이름(`Name`), 크기(`PageSize Width/Height`, 화면 픽셀), 처음 열릴 페이지(`Workbook CurrentPage`).
- `WorkbookItem`이 디스플레이 하나입니다.
  - `GUID`: 종류. `CSTextEdit`(텍스트), `CSTextEntry`(답 입력란), `CSImageAnalysis`(그림/동영상), `CSLineGraph`(그래프), `CSDataTable`(표), `CSDataDigits`(숫자) 등
  - `Position X/Y`, `Size Width/Height`: 페이지에 대한 비율(0~1)
  - `ZValue`: 쌓임 순서, `ShowFrame`: 테두리, `TitleVisible` + `DisplayTitle DisplayTitleText`: 제목(Qt HTML)
- 텍스트는 Qt 서식 HTML(`HTML` 속성)입니다. `line-height` 백분율은 Qt에서 각 줄 글꼴 기준이라, CSS에서는 단위 없는 배수로 바꿔야 줄이 겹치지 않습니다.
- 디스플레이의 `BundleInput`
  - `BundleMeasID`: 측정값 (`EUID`)
  - `BundleDataSetID`: 런. 모두 0이면 "최신 런을 따라감"
  - `DataAdapter ConverterConverterUnit`: 표시 단위
  - `InputNumberFormatter FixedDecimals`: 소수 자릿수 (`InputUsingDefaultNumberFormat="FALSE"`일 때)
- 그래프(`CSLineGraph`)
  - `ZPlotArea/ZLinearAxis/BundleInput[BundleIndex=0]`: 가로축 측정값
  - `ZRenderSet/ZLinearAxis/BundleInput[BundleIndex=1]` 또는 `ZRSNonDataSelectorProvidedInputs EUID`: 세로축 측정값
  - `ZRSIndividualRenederer`(철자 그대로): 런마다 하나, `ZTDDRBPActive="1"`이면 표시 중
  - `ZTwoDimensionDataRenderBasicProperties`: `ZTDDRBPShowDataPoints`, `ZTDDRBPShowConnectingLines`
  - `LineGraphCurveFitChecked LineGraphCurveFitType="1"`: 직선 맞춤 표시

## 단위 코드

`BaseUnit`/`DefaultUnit`/`ConverterConverterUnit` 값입니다. 상위 바이트가 같은 코드끼리 같은 물리량입니다.

| 코드 | 단위 | 코드 | 단위 |
| --- | --- | --- | --- |
| 256 | s | 2048 | m/s² |
| 1024 | V | 2304 | m/s |
| 1025 | mV | 3330 | C |
| 1280 | m | 3584 | A |
| 1794 | T | 3585 | mA |
| 10496 | kg | 32768 | 사용자 지정 (`CustomUnitString`) |

1792(자기장 센서의 기본 단위)처럼 확인하지 못한 코드는 단위를 비워 둡니다. 새 코드는 `js/cap.js`의 `UNITS` 표에 추가하면 됩니다.
