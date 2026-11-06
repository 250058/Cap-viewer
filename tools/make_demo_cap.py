#!/usr/bin/env python3
"""Generate examples/demo.cap: a small synthetic Capstone-style file.

It mimics the layout of real .cap files (main.xml + data/*.tmp with 12-byte
records) so the viewer and its tests have an example that contains no
personal lab data. Scenario: a cart rolls down a ramp in front of a motion
sensor at 20 Hz, three runs at different ramp angles.

Usage: python3 tools/make_demo_cap.py [output_path]
"""
import math
import random
import struct
import sys
import uuid
import zipfile
from xml.sax.saxutils import quoteattr

PERIOD = 0.05
CAPACITY = 2400  # records per pre-allocated data file, like Capstone
RUNS = [
    # (name, ramp angle in degrees, number of samples)
    ("경사 5° - 1회", 5, 42),
    ("경사 10° - 1회", 10, 33),
    ("경사 15° - 1회", 15, 28),
]
MEAS = {
    "Position": ("{fbcdb55d-c9ff-4471-aeed-5a37992e1dc3}", 1280, "pos", "x", 2),
    "Velocity": ("{1d42fb7c-194f-4f07-958e-70c1a5cd6c18}", 2304, "vel", "v", 2),
    "Acceleration": ("{3db8b09c-73b5-4d3d-87a2-b5b52afcfe7f}", 2048, "acc", "a", 1),
}
TIME_ID = "{e14c506e-0c14-46fa-a835-3303633a4558}"
SENSOR_ID = "{8675e090-71bd-4f04-bba4-9d41e48a50de}"


def gid(rng):
    return "{" + str(uuid.UUID(int=rng.getrandbits(128), version=4)) + "}"


def records(values):
    buf = bytearray(CAPACITY * 12)
    for i, v in enumerate(values):
        # Capstone sometimes sets higher flag bits on valid samples (seen: 0x00020001); keep one
        # such record so the viewer's tests cover it.
        flag = 0x00020001 if i == len(values) - 1 else 1
        struct.pack_into("<Id", buf, i * 12, flag, v)
    return bytes(buf)


def simulate(rng, angle, n):
    a = 9.80665 * math.sin(math.radians(angle)) - 0.06  # rolling friction
    t_release = 0.5
    x0 = 0.250
    pos = []
    for i in range(n):
        t = i * PERIOD
        dt = max(0.0, t - t_release)
        x = x0 + 0.5 * a * dt * dt
        pos.append(round(x + rng.gauss(0, 0.0006), 4))
    vel = [(pos[i + 1] - pos[i - 1]) / (2 * PERIOD) for i in range(1, n - 1)]
    acc = [(vel[i + 1] - vel[i - 1]) / (2 * PERIOD) for i in range(1, len(vel) - 1)]
    return pos, vel, acc


def qt_html(body_html, size=14):
    """Wrap content the way Capstone's (Qt) text boxes store it."""
    return ('<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.0//EN" "http://www.w3.org/TR/REC-html40/strict.dtd">\n'
            '<html><head><meta name="qrichtext" content="1" /><style type="text/css">\np, li { white-space: pre-wrap; }\n</style></head>'
            '<body style=" font-family:\'DejaVu Sans\'; font-size:%dpx; font-weight:400; font-style:normal;">\n%s</body></html>' % (size, body_html))


def P(text, size=20, color=None, top=6):
    style = " margin-top:%dpx; margin-bottom:6px; margin-left:0px; margin-right:0px; -qt-block-indent:0; text-indent:0px;" % top
    span = " font-size:%dpx;%s" % (size, " color:%s;" % color if color else "")
    return '<p style="%s"><span style="%s">%s</span></p>\n' % (style, span, text)


def item(guid, x, y, w, h, z, inner, title="", title_visible=False, frame=False):
    t = qt_html('<p style=" margin-top:0px; margin-bottom:0px;">%s</p>' % (title or "[Text title here]"))
    return ('  <WorkbookItem GUID="%s" ZValue="%r" TitleVisible="%s" ShowFrame="%s">'
            '<BackgroundColor R="255" G="255" B="255" A="255"/><Position X="%r" Y="%r"/><Size Width="%r" Height="%r"/>'
            '<DisplayTitle DisplayTitleText=%s/>%s</WorkbookItem>'
            % (guid, z, "TRUE" if title_visible else "FALSE", "TRUE" if frame else "FALSE", x, y, w, h, quoteattr(t), inner))


def bundle(index, meas_id, ds_id="{00000000-0000-0000-0000-000000000000}", unit=None):
    adapter = '<DataAdapter ConverterBaseUnit="%d" ConverterConverterUnit="%d"/>' % (unit, unit) if unit else ""
    return '<BundleInput BundleIndex="%d" BundleMeasID=%s BundleDataSetID=%s InputUsingDefaultNumberFormat="TRUE">%s</BundleInput>' % (
        index, quoteattr(meas_id), quoteattr(ds_id), adapter)


def workbook(runs):
    pos_id, vel_id = MEAS["Position"][0], MEAS["Velocity"][0]
    intro = (P("경사면에서 수레의 운동", 30, "#0000ff", 0)
             + P("목표", 22, "#0000ff", 14)
             + P("경사각을 바꾸어 가며 수레의 위치를 동작 센서로 측정하고, 위치–시간 그래프의 2차 맞춤으로 가속도를 구한다.", 18)
             + P("실험 방법", 22, "#0000ff", 14)
             + '<ol style="margin-top:0px; margin-bottom:0px; margin-left:0px; margin-right:0px; -qt-list-indent: 1;">'
             + ''.join('<li style=" font-size:18px; margin-top:4px;">%s</li>' % t for t in (
                 "트랙 위쪽 끝에 동작 센서를 놓고 경사각을 5°로 맞춘다.",
                 "기록 버튼을 누르고 0.5초 뒤 수레를 놓는다.",
                 "경사각 10°, 15°에서 반복한다.",
                 "<b>데이터 분석</b> 페이지에서 구간을 선택해 2차 맞춤을 한다."))
             + '</ol>'
             + P("이론: x = x<span style=\" vertical-align:sub;\">0</span> + ½at², a = g sinθ − (마찰)", 18, "#231f20", 14))
    answer = P("경사각이 커질수록 가속도가 커졌다. 15°에서 2A ≈ 2.48 m/s²로 g sin15° 와 거의 같았다.", 16)
    picture = '<CSImageAnalysis><CSVideoPlayer><Snapshot FileName="images\\Capture Image{demo-ramp}.png"/></CSVideoPlayer></CSImageAnalysis>'
    graph = ('<CSLineGraph><LineGraphPlotAreaElement><ZPlotArea>'
             '<ZLinearAxis>%s</ZLinearAxis>'
             '<ZTwoDimensionDataRenderBasicProperties ZTDDRBPShowDataPoints="0" ZTDDRBPShowConnectingLines="1"/>'
             '<ZPlotAreaRenderSet><ZRenderSet><ZLinearAxis>%s</ZLinearAxis>'
             '<ZRSNonDataSelectorProvidedInputs EUID=%s TokenUnitType="1280"/>' % (bundle(0, TIME_ID, unit=256), bundle(1, pos_id, unit=1280), quoteattr(pos_id)))
    for r in runs:
        graph += ('<ZRSIndividualRenederer><ZTwoDimensionDataRenderBasicProperties ZTDDRBPActive="1"/>%s%s</ZRSIndividualRenederer>'
                  % (bundle(0, TIME_ID, r["id"]), bundle(1, pos_id, r["id"])))
    graph += '</ZRenderSet></ZPlotAreaRenderSet></ZPlotArea></LineGraphPlotAreaElement></CSLineGraph>'
    last = runs[-1]["id"]
    table = '<CSDataTable><DataBundle>%s%s%s</DataBundle></CSDataTable>' % (
        bundle(0, TIME_ID, last, 256), bundle(1, pos_id, last, 1280), bundle(2, vel_id, last, 2304))
    digits = '<CSDataDigits><DataBundle>%s</DataBundle></CSDataDigits>' % bundle(0, vel_id, last, 2304)
    out = [' <Workbook CurrentPage="0">']
    out.append(' <WorkbookPage Name="실험 안내"><PageSize Width="1120" Height="580"/>')
    out.append(item("CSTextEdit", 0.02, 0.03, 0.55, 0.94, 0.001, '<CSTextEdit HTML=%s/>' % quoteattr(qt_html(intro))))
    out.append(item("CSImageAnalysis", 0.60, 0.05, 0.38, 0.45, 0.002, picture, "그림 1: 실험 장치", True))
    out.append(item("CSTextEntry", 0.60, 0.58, 0.38, 0.38, 0.003, '<CSTextEntry ObjectName="Text Entry #1" HTML=%s/>' % quoteattr(qt_html(answer)),
                    "질문: 경사각과 가속도의 관계는?", True, True))
    out.append(' </WorkbookPage>')
    out.append(' <WorkbookPage Name="데이터 분석"><PageSize Width="1120" Height="580"/>')
    out.append(item("CSTextEdit", 0.02, 0.02, 0.36, 0.08, 0.001, '<CSTextEdit HTML=%s/>' % quoteattr(qt_html(P("데이터 분석", 24, "#0000ff", 0)))))
    out.append(item("CSDataDigits", 0.02, 0.12, 0.36, 0.18, 0.002, digits, "마지막 속도", True, True))
    out.append(item("CSDataTable", 0.02, 0.33, 0.36, 0.64, 0.003, table, "표 1: 경사 15°", True))
    out.append(item("CSLineGraph", 0.40, 0.02, 0.58, 0.95, 0.004, graph, "그래프 1: 위치–시간", True))
    out.append(' </WorkbookPage>')
    out.append(' </Workbook>')
    return out


def ramp_png():
    """A small line drawing of the setup (PNG), made without external tools."""
    import zlib
    W, H = 480, 260
    px = bytearray([255] * (W * H * 3))

    def dot(x, y, c, r=2):
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                X, Y = int(x + dx), int(y + dy)
                if 0 <= X < W and 0 <= Y < H and dx * dx + dy * dy <= r * r:
                    i = (Y * W + X) * 3
                    px[i:i + 3] = bytes(c)

    def line(x0, y0, x1, y1, c, r=2):
        n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
        for k in range(n + 1):
            dot(x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n, c, r)

    gray, blue, red, dark = (120, 126, 136), (31, 95, 209), (214, 45, 32), (40, 44, 52)
    line(30, 220, 450, 220, gray, 2)            # table
    line(40, 220, 440, 120, dark, 3)            # ramp
    line(440, 120, 440, 220, dark, 2)           # support
    for t in range(0, 30):                      # sensor box at the top end
        line(415, 96 + t, 455, 96 + t, blue, 0)
    cx, cy = 300, 155                           # cart on the ramp
    line(cx - 30, cy + 7, cx + 30, cy - 8, red, 9)
    dot(cx - 20, cy + 16, dark, 6)
    dot(cx + 20, cy + 6, dark, 6)
    for k in range(5):                          # sound waves
        line(400 - k * 22, 108 + k * 6, 404 - k * 22, 124 + k * 6, blue, 1)
    raw = b"".join(b"\x00" + bytes(px[y * W * 3:(y + 1) * W * 3]) for y in range(H))

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def main(out):
    rng = random.Random(20261105)
    files = {}
    runs = []
    start = 1793184000
    for k, (name, angle, n) in enumerate(RUNS):
        pos, vel, acc = simulate(rng, angle, n)
        run_id = gid(rng)
        data = {"Position": (pos, 0.0), "Velocity": (vel, PERIOD), "Acceleration": (acc, 2 * PERIOD)}
        fnames = {}
        for m, (vals, t0) in data.items():
            fn = "data/Z_demo_%d_%s.tmp" % (k + 1, m[:3].lower())
            files[fn] = records(vals)
            fnames[m] = (fn, len(vals), t0)
        runs.append({"id": run_id, "number": k + 1, "name": name, "start": start + k * 120, "n": n, "files": fnames})

    x = ['<DSProExperiment>']
    x.append(' <Header ArgumentSeparator="," DecimalSeparator="." Language="kor" Version="2.14.6"/>')
    x.append(' <Hardware Version="1">')
    x.append('  <Interface Type="1042" VirtualDeviceName="demo-001">')
    x.append('   <Channel Index="0">')
    x.append('    <Sensor EUID=%s ID="2048" Name="Wireless Motion Sensor" SamplePeriod="%r">' % (quoteattr(SENSOR_ID), PERIOD))
    for i, (m, (mid, _u, _s, _sym, _d)) in enumerate(MEAS.items()):
        x.append('     <Measurement EUID=%s ID="%d" Name=%s/>' % (quoteattr(mid), i + 1, quoteattr(m)))
    x.append('    </Sensor>')
    x.append('   </Channel>')
    x.append('  </Interface>')
    x.append(' </Hardware>')
    x.append(' <DataRepository>')
    x.append('  <MasterTimeMeasurement BaseUnit="256" EUID=%s LongName="Time" MeasurementName="Time" ShortName="time" SymbolName="t"/>' % quoteattr(TIME_ID))
    for m, (mid, unit, short, sym, dec) in MEAS.items():
        x.append('  <DataSource BaseUnit="%d" ChannelIDName="demo-001" DataMeasSourceType="1000" EUID=%s LongName=%s MeasurementName=%s ShortName=%s SymbolName=%s>'
                 % (unit, quoteattr(mid), quoteattr(m), quoteattr(m), quoteattr(short), quoteattr(sym)))
        x.append('   <DataSourceNumberFormatter FixedDecimals="%d" OutputFormatMode="1"/>' % dec)
        for r in runs:
            fn, count, t0 = r["files"][m]
            x.append('   <DataSet DataGroupNumber="%d" DataHasBeenDeleted="FALSE" DataSetID=%s>' % (r["number"], quoteattr(r["id"])))
            x.append('    <DataSegmentElement>')
            x.append('     <DependentStorageElement DataCacheDataSize="%d" DataOffsetValue="0" FileName=%s StorageType="0"/>' % (count, quoteattr(fn)))
            x.append('     <IndependentStorageElement CacheDataCount="%d" IntervalCacheInterval="%r" IntervalCacheStartValue="%r" StorageType="1"/>' % (count, PERIOD, t0))
            x.append('    </DataSegmentElement>')
            x.append('   </DataSet>')
        x.append('  </DataSource>')
    x.append('  <RunParameters>')
    x.append('   <RunParameterGroup>')
    for r in runs:
        x.append('    <RunParameterSet RunParameterID=%s>' % quoteattr(r["id"]))
        x.append('     <ParameterValue RecordingStartTime="%d"/>' % r["start"])
        x.append('     <ParameterValue RunNumber="%d"/>' % r["number"])
        x.append('     <ParameterValue RunStartTime="%d"/>' % r["start"])
        x.append('     <ParameterValue RunName=%s/>' % quoteattr(r["name"]))
        x.append('     <ParameterValue RunStopTime="%d"/>' % (r["start"] + math.ceil(r["n"] * PERIOD)))
        x.append('     <ParameterValue><SampleRates Period="%r" SensorID=%s/></ParameterValue>' % (PERIOD, quoteattr(SENSOR_ID)))
        x.append('    </RunParameterSet>')
    x.append('   </RunParameterGroup>')
    x.append('  </RunParameters>')
    x.append(' </DataRepository>')
    x.extend(workbook(runs))
    x.append('</DSProExperiment>')

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("main.xml", "\n".join(x).encode("utf-8"))
        for fn, data in files.items():
            z.writestr(fn, data)
        z.writestr("images/Capture Image{demo-ramp}.png", ramp_png())
    print("wrote", out)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "examples/demo.cap")
