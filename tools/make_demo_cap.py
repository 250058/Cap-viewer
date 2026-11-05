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
        struct.pack_into("<Id", buf, i * 12, 1, v)
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
    # Graph page: position vs time, all runs shown
    pos_id = MEAS["Position"][0]
    x.append(' <Workbook><WorkbookPage Name="Page #1"><WorkbookItem GUID="CSLineGraph"><CSLineGraph><ZRenderSet>')
    x.append('  <ZRSNonDataSelectorProvidedInputs EUID=%s/>' % quoteattr(pos_id))
    for r in runs:
        x.append('  <ZRSIndividualRenederer><ZTwoDimensionDataRenderBasicProperties ZTDDRBPActive="1"/>'
                 '<BundleInput BundleDataSetID=%s BundleIndex="0" BundleMeasID=%s/>'
                 '<BundleInput BundleDataSetID=%s BundleIndex="1" BundleMeasID=%s/></ZRSIndividualRenederer>'
                 % (quoteattr(r["id"]), quoteattr(TIME_ID), quoteattr(r["id"]), quoteattr(pos_id)))
    x.append(' </ZRenderSet></CSLineGraph></WorkbookItem></WorkbookPage></Workbook>')
    x.append('</DSProExperiment>')

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("main.xml", "\n".join(x).encode("utf-8"))
        for fn, data in files.items():
            z.writestr(fn, data)
    print("wrote", out)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "examples/demo.cap")
