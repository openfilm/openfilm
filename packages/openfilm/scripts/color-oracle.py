"""Reference outputs for OpenFilm's color transform evaluator (packages/openfilm/src/color), from OpenColorIO itself.

Writes packages/openfilm/src/color/fixtures/ops/*.ctf (and .clf, .cube): small files that cover every op and style
src/color/ctf.mjs reads, with non-default parameters; and two JSON files of OCIO's outputs for one fixed set of input
triples (values outside 0-1 and negatives included):
  fixtures/ops.json         the files above
  fixtures/transforms.json  OpenFilm's own transforms, src/color/transforms/*.ctf

OCIO evaluates each file through a FileTransform with OPTIMIZATION_NONE, so every op runs as itself with exact math
where OCIO has it (no fast pow/log/exp, no ops folded together). A few OCIO CPU renderers use fast approximations
whatever the optimization (SSE.h, about 15 bits): each case says the tolerance it needs and why.

Run with PyOpenColorIO 2.6 (and numpy): `python3 packages/openfilm/scripts/color-oracle.py`. The tests never run it;
they read the files it writes.
"""
import glob, json, os
import numpy as np
import PyOpenColorIO as O

assert O.__version__.startswith('2.6'), f'PyOpenColorIO 2.6 is needed, not {O.__version__}'

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'color')
FIXTURES = os.path.join(ROOT, 'fixtures')
OPS_DIR = os.path.join(FIXTURES, 'ops')
CFG = O.Config.CreateRaw()

# Tolerances: |js - ocio| <= abs + rel * |ocio|. The relative part matters only for large values: OCIO computes in single
# precision, which past about 2 cannot hold 1e-5, and its exp2 of a large argument is a few float steps off.
EXACT = {'abs': 1e-5, 'rel': 5e-6}
# OCIO's CPU renderer uses its ssePower / sseLog2 / sseExp2 here whatever the optimization (about 15 bits, up to ~3e-5
# relative each); the evaluator uses the exact functions.
FAST_POW = {'abs': 1e-5, 'rel': 1e-4, 'why': "OCIO's CPU renderer uses its ~15-bit SSE pow/log2/exp2 approximations"}
# Log or video code values (log- and video-style grading, a chain that starts by decoding log): inputs up to 1.5, half
# past white. Further out, extrapolated curves and exp2 grow past what single precision holds.
CODE = 1.5


def inputs():
    """One fixed set of float32 RGB triples: grays, primaries, small and large values, negatives, random colors."""
    rng = np.random.default_rng(2026)
    rows = [[v, v, v] for v in (0, 1e-6, 0.002, 0.01, 0.05, 0.18, 0.4, 0.5, 0.75, 1, 1.5, 4, 16, -0.01, -0.2)]
    rows += [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [0, 1, 1], [1, 0, 1], [0.8, 0.2, 0.1], [0.1, 0.3, 0.9],
             [-0.05, 0.4, 0.9], [1.2, -0.1, 0.3], [0.002, 0.0005, 0.004]]
    rows += rng.uniform(-0.2, 1.2, (120, 3)).tolist()
    rows += rng.uniform(-1, 4, (24, 3)).tolist()
    rows += (2.0 ** rng.uniform(-14, 6, (22, 3))).tolist()
    return np.array(rows, dtype=np.float32)


def run_file(path, rgb):
    proc = CFG.getProcessor(O.FileTransform(src=os.path.abspath(path), interpolation=O.INTERP_DEFAULT))
    cpu = proc.getOptimizedCPUProcessor(O.BIT_DEPTH_F32, O.BIT_DEPTH_F32, O.OPTIMIZATION_NONE)
    out = rgb.copy()
    cpu.applyRGB(out)
    return out


def ctf(body, version='2.5'):
    return (f'<?xml version="1.0" encoding="UTF-8"?>\n<ProcessList version="{version}" id="fixture">\n'
            f'    <Description>OpenFilm color fixture</Description>\n{body}\n</ProcessList>\n')


def clf(body):
    return (f'<?xml version="1.0" encoding="UTF-8"?>\n<ProcessList compCLFversion="3.0" id="fixture">\n'
            f'{body}\n</ProcessList>\n')


def op(tag, attrs='', inner='', depth=('32f', '32f')):
    return f'    <{tag} inBitDepth="{depth[0]}" outBitDepth="{depth[1]}" {attrs}>\n{inner}\n    </{tag}>'


def array(dim, values):
    return f'        <Array dim="{dim}">\n' + ' '.join(repr(float(v)) for v in values) + '\n        </Array>'


def curve(tag, points, slopes=None):
    pts = ' '.join(f'{x} {y}' for x, y in points)
    s = f'\n            <Slopes>{" ".join(str(v) for v in slopes)}</Slopes>' if slopes else ''
    return f'        <{tag}>\n            <ControlPoints>{pts}</ControlPoints>{s}\n        </{tag}>'


def half_lut_values():
    """A half-domain LUT that maps each half to the next one up (the test builds the same table)."""
    out = []
    for i in range(65536):
        out.append(i + 1 if (i & 0x7fff) < 0x7bff else (i & 0x8000) | 0x3c00)
    return out


def cases():
    """(name, file name, text, tolerance, largest input magnitude or None)."""
    c = []
    add = lambda name, text, tol=EXACT, ext='ctf', max_input=None: c.append((name, f'{name}.{ext}', text, tol, max_input))
    M = [1.2, -0.1, 0.05, 0.03, 0.9, 0.1, -0.02, 0.15, 1.1]
    # Matrix
    add('matrix-3x3', ctf(op('Matrix', inner=array('3 3', M))))
    add('matrix-3x4', ctf(op('Matrix', inner=array('3 4', M[0:3] + [0.05] + M[3:6] + [-0.02] + M[6:9] + [0.1]))))
    add('matrix-4x4', ctf(op('Matrix', inner=array('4 4 4', M[0:3] + [0.05] + M[3:6] + [-0.03] + M[6:9] + [0.02] + [0.1, 0.2, 0.3, 0.9]))))
    add('matrix-4x5', ctf(op('Matrix', inner=array('4 5 4', M[0:3] + [0.05, 0.01] + M[3:6] + [-0.03, 0.02] + M[6:9] + [0.02, -0.04] + [0, 0, 0, 1, 0]))))
    add('matrix-10i', ctf(op('Matrix', inner=array('3 4 3', M[0:3] + [64] + M[3:6] + [-20] + M[6:9] + [10]), depth=('10i', '10i'))))
    add('matrix-8i-16i', ctf(op('Matrix', inner=array('3 3', M), depth=('8i', '16i'))))
    # Range
    add('range-scale', ctf(op('Range', inner='<minInValue>0.1</minInValue><maxInValue>0.9</maxInValue>'
                                            '<minOutValue>-0.1</minOutValue><maxOutValue>1.2</maxOutValue>')))
    add('range-min', ctf(op('Range', inner='<minInValue>0.05</minInValue><minOutValue>0.05</minOutValue>')))
    add('range-max', ctf(op('Range', inner='<maxInValue>0.8</maxInValue><maxOutValue>0.8</maxOutValue>')))
    add('range-noclamp', clf(op('Range', 'style="noClamp"', '<minInValue>0.1</minInValue><maxInValue>0.9</maxInValue>'
                                                           '<minOutValue>0</minOutValue><maxOutValue>1</maxOutValue>')), ext='clf')
    add('range-10i', ctf(op('Range', inner='<minInValue>64</minInValue><maxInValue>940</maxInValue>'
                                          '<minOutValue>0</minOutValue><maxOutValue>1</maxOutValue>', depth=('10i', '32f'))))
    # Log
    for style in ('log10', 'log2', 'antiLog10', 'antiLog2'):
        add(f'log-{style}', ctf(op('Log', f'style="{style}"')))
    add('log-linToLog', clf(op('Log', 'style="linToLog"', '<LogParams base="10" logSideSlope="0.25" logSideOffset="0.6" '
                                                          'linSideSlope="1.1" linSideOffset="0.01"/>')), ext='clf')
    add('log-logToLin-channels', ctf(op('Log', 'style="logToLin"',
        '<LogParams channel="R" base="2" logSideSlope="0.08" logSideOffset="0.5" linSideSlope="1" linSideOffset="0.005"/>'
        '<LogParams channel="G" base="2" logSideSlope="0.09" logSideOffset="0.45" linSideSlope="1.2" linSideOffset="0.004"/>'
        '<LogParams channel="B" base="2" logSideSlope="0.07" logSideOffset="0.55" linSideSlope="0.9" linSideOffset="0.006"/>')))
    slog3 = 'base="10" logSideSlope="0.255620723362659" logSideOffset="0.410557184750733" linSideSlope="5.26315789473684" linSideOffset="0.0526315789473684" linSideBreak="0.01125"'
    add('log-cameraLinToLog', ctf(op('Log', 'style="cameraLinToLog"', f'<LogParams {slog3}/>')))
    add('log-cameraLogToLin', ctf(op('Log', 'style="cameraLogToLin"', f'<LogParams {slog3}/>')))
    add('log-camera-linearSlope', ctf(op('Log', 'style="cameraLinToLog"', f'<LogParams {slog3} linearSlope="5.5"/>')))
    add('log-cineon-linToLog', ctf(op('Log', 'style="linToLog"', '<LogParams gamma="0.6" refWhite="685" refBlack="95" highlight="1" shadow="0"/>')))
    add('log-cineon-logToLin', ctf(op('Log', 'style="logToLin"', '<LogParams gamma="0.6" refWhite="685" refBlack="95" highlight="1" shadow="0"/>'), '1.3'))
    # Exponent (CLF names) and Gamma (CTF names)
    for style in ('basicFwd', 'basicRev', 'basicMirrorFwd', 'basicMirrorRev', 'basicPassThruFwd', 'basicPassThruRev'):
        add(f'exponent-{style}', clf(op('Exponent', f'style="{style}"', '<ExponentParams exponent="2.4"/>'
                                         '<ExponentParams channel="B" exponent="1.8"/>')), ext='clf')
    for style in ('monCurveFwd', 'monCurveRev', 'monCurveMirrorFwd', 'monCurveMirrorRev'):
        add(f'exponent-{style}', clf(op('Exponent', f'style="{style}"', '<ExponentParams exponent="2.4" offset="0.055"/>'
                                         '<ExponentParams channel="G" exponent="2.2" offset="0.099"/>')), ext='clf')
    add('gamma-ctf', ctf(op('Gamma', 'style="basicFwd"', '<GammaParams gamma="2.2"/><GammaParams channel="A" gamma="1"/>'), '1.5'))
    # ASC CDL
    sop = ('<SOPNode><Slope>1.1 0.95 1.05</Slope><Offset>0.02 -0.01 0.03</Offset><Power>1.2 0.9 1.1</Power></SOPNode>'
           '<SatNode><Saturation>1.3</Saturation></SatNode>')
    for style in ('Fwd', 'FwdNoClamp', 'Rev', 'RevNoClamp'):
        add(f'cdl-{style}', clf(op('ASC_CDL', f'style="{style}"', sop)), ext='clf')
    add('cdl-default-style', ctf(op('ASC_CDL', '', sop)))
    add('cdl-ctf-names', ctf(op('ASC_CDL', 'style="noClampRev"', sop)))
    # ExposureContrast
    ec = '<ECParams exposure="0.6" contrast="1.25" gamma="1.1" pivot="0.2"/>'
    for style in ('linear', 'linearRev', 'video', 'videoRev'):
        add(f'ec-{style}', ctf(op('ExposureContrast', f'style="{style}"', ec)), FAST_POW)
    add('ec-linear-contrast1', ctf(op('ExposureContrast', 'style="linear"', '<ECParams exposure="-1.5" contrast="1" pivot="0.18"/>')))
    ecl = '<ECParams exposure="1.2" contrast="1.3" gamma="0.9" pivot="0.3" logExposureStep="0.1" logMidGray="0.4"/>'
    add('ec-log', ctf(op('ExposureContrast', 'style="log"', ecl)))
    add('ec-logRev', ctf(op('ExposureContrast', 'style="logRev"', ecl)))
    # GradingPrimary
    gp_log = ('<Brightness rgb="0.02 0 -0.03" master="0.05"/><Contrast rgb="1.1 1 0.95" master="1.2"/>'
              '<Gamma rgb="1 1.05 0.9" master="0.95"/><Saturation master="1.15"/><Pivot contrast="-0.1"/>'
              '<Clamp black="-0.05" white="1.1"/>')
    gp_lin = ('<Offset rgb="0.01 0 -0.01" master="0.005"/><Exposure rgb="0.2 0 -0.1" master="0.3"/>'
              '<Contrast rgb="1.1 1 0.9" master="1.15"/><Saturation master="0.85"/><Pivot contrast="0.1"/>')
    gp_vid = ('<Offset rgb="0.01 0 -0.01" master="0.005"/><Lift rgb="0.02 0 0.01" master="-0.01"/>'
              '<Gamma rgb="1.1 1 0.9" master="1.05"/><Gain rgb="1.1 1 0.95" master="1.05"/><Saturation master="1.2"/>'
              '<Pivot black="0.05" white="0.95"/><Clamp black="0" white="1"/>')
    for style, body in (('log', gp_log), ('linear', gp_lin), ('video', gp_vid)):
        domain = None if style == 'linear' else CODE
        add(f'primary-{style}', ctf(op('GradingPrimary', f'style="{style}"', body)), FAST_POW, max_input=domain)
        add(f'primary-{style}Rev', ctf(op('GradingPrimary', f'style="{style}Rev"', body)), FAST_POW, max_input=domain)
    add('primary-log-nogamma', ctf(op('GradingPrimary', 'style="log"', '<Brightness rgb="0.02 0 -0.03" master="0.05"/>'
                                      '<Contrast rgb="1.1 1 0.95" master="1.2"/><Saturation master="1.15"/>')), max_input=CODE)
    # GradingTone
    tone_a = ('<Blacks rgb="0.9 1 1.1" master="0.8" start="0.4" width="0.4"/>'
              '<Shadows rgb="1.2 1 0.9" master="0.7" start="0.5" pivot="0"/>'
              '<Midtones rgb="1.1 0.9 1" master="1.2" center="0.4" width="0.6"/>'
              '<Highlights rgb="0.8 1 1.2" master="1.3" start="0.3" pivot="1"/>'
              '<Whites rgb="1.1 1 0.9" master="0.85" start="0.4" width="0.5"/>'
              '<SContrast master="1.2"/>')
    tone_b = ('<Blacks rgb="1.2 1 0.8" master="1.3" start="0.4" width="0.4"/>'
              '<Shadows rgb="0.8 1 1.3" master="1.4" start="0.5" pivot="0"/>'
              '<Midtones rgb="0.9 1.1 1" master="0.7" center="0.55" width="0.5"/>'
              '<Highlights rgb="1.2 1 0.8" master="0.6" start="0.3" pivot="1"/>'
              '<Whites rgb="0.9 1 1.1" master="1.4" start="0.4" width="0.5"/>'
              '<SContrast master="0.7"/>')
    tone_lin = ('<Blacks rgb="1 1 1" master="1.2" start="0" width="4"/>'
                '<Shadows rgb="1 1 1" master="0.8" start="2" pivot="-7"/>'
                '<Midtones rgb="1 1.1 1" master="1.15" center="0" width="8"/>'
                '<Highlights rgb="1 1 1" master="1.2" start="-2" pivot="9"/>'
                '<Whites rgb="1 1 1" master="0.9" start="0" width="8"/>'
                '<SContrast master="1.3"/>')
    add('tone-log-a', ctf(op('GradingTone', 'style="log"', tone_a)), max_input=CODE)
    add('tone-log-b', ctf(op('GradingTone', 'style="log"', tone_b)), max_input=CODE)
    add('tone-video', ctf(op('GradingTone', 'style="video"', tone_a.replace('start="0.5" pivot="0"', 'start="0.6" pivot="0"'))), max_input=CODE)
    add('tone-linear', ctf(op('GradingTone', 'style="linear"', tone_lin)), FAST_POW)
    add('tone-midtones-only', ctf(op('GradingTone', 'style="log"', '<Midtones rgb="1 1 1" master="1.4" center="0.7" width="0.4"/>')), max_input=CODE)
    # GradingRGBCurve
    rgb_log = '\n'.join([
        curve('Red', [(0, 0.02), (0.3, 0.35), (0.7, 0.72), (1, 1)]),
        curve('Green', [(0, 0), (0.5, 0.45), (1, 1.05)]),
        curve('Blue', [(-0.1, -0.1), (0.2, 0.25), (0.6, 0.55), (1.2, 1.1)], [1.2, 1.1, 0.9, 0.8]),
        curve('Master', [(0, 0), (0.25, 0.2), (0.5, 0.5), (0.75, 0.82), (1, 1)])])
    add('rgbcurve-log', ctf(op('GradingRGBCurve', 'style="log"', rgb_log)), max_input=CODE)
    add('rgbcurve-logRev', ctf(op('GradingRGBCurve', 'style="logRev"', rgb_log)), max_input=CODE)
    add('rgbcurve-video', ctf(op('GradingRGBCurve', 'style="video"', rgb_log)), max_input=CODE)
    rgb_lin = '\n'.join([curve('Master', [(-7, -7), (-2, -2.4), (0, 0), (2, 2.3), (7, 7)]),
                         curve('Red', [(-7, -6.8), (0, 0.1), (7, 7)])])
    add('rgbcurve-linear', ctf(op('GradingRGBCurve', 'style="linear"', rgb_lin)), FAST_POW)
    add('rgbcurve-linear-bypass', ctf(op('GradingRGBCurve', 'style="linear" bypassLinToLog="true"', rgb_lin)))
    add('rgbcurve-steep', ctf(op('GradingRGBCurve', 'style="log"', curve('Master', [(0, 0), (0.1, 0.4), (0.15, 0.42), (0.9, 0.5), (1, 1)]))), max_input=CODE)
    # GradingHueCurve
    hue = '\n'.join([
        curve('HueHue', [(0, 0), (0.2, 0.25), (0.4, 0.38), (0.6, 0.6), (0.8, 0.85)]),
        curve('HueSat', [(0, 1.2), (0.33, 0.8), (0.66, 1.4)]),
        curve('HueLum', [(0.1, 1.1), (0.5, 0.9), (0.9, 1)]),
        curve('LumSat', [(0, 0.8), (0.5, 1.2), (1, 0.9)]),
        curve('SatSat', [(0, 0), (0.3, 0.4), (1, 0.95)]),
        curve('LumLum', [(0, 0.02), (0.5, 0.48), (1, 1.02)]),
        curve('SatLum', [(0, 1), (0.5, 0.95), (1, 1.1)]),
        curve('HueFx', [(0, 0), (0.3, 0.05), (0.6, -0.04), (0.9, 0)])])
    add('huecurve-log', ctf(op('GradingHueCurve', 'style="log"', hue)), max_input=CODE)
    add('huecurve-video', ctf(op('GradingHueCurve', 'style="video"', hue)), max_input=CODE)
    hue_lin = hue.replace(curve('LumSat', [(0, 0.8), (0.5, 1.2), (1, 0.9)]), curve('LumSat', [(-7, 0.8), (0, 1.2), (7, 0.9)])) \
                 .replace(curve('LumLum', [(0, 0.02), (0.5, 0.48), (1, 1.02)]), curve('LumLum', [(-7, -7), (0, 0.2), (7, 7)]))
    # Dark out-of-gamut colors go through steep gains in the linear HSY model (one test color's blue goes from 0.98 to
    # 67.6), which multiply OCIO's single-precision rounding.
    add('huecurve-linear', ctf(op('GradingHueCurve', 'style="linear"', hue_lin)),
        {'abs': 1e-5, 'rel': 4e-5, 'why': 'steep gains of the linear HSY model on dark out-of-gamut colors magnify single-precision rounding'})
    add('huecurve-nohsy', ctf(op('GradingHueCurve', 'style="log" hsyTransform="none"', curve('SatSat', [(0, 0), (0.5, 0.6), (1, 1)]))), max_input=CODE)
    add('huecurve-slopes', ctf(op('GradingHueCurve', 'style="log"',
        curve('HueSat', [(0.1, 1.1), (0.4, 0.9), (0.7, 1.3)], [0.5, -0.2, 0.4]) + '\n' +
        curve('LumLum', [(0, 0), (0.5, 0.55), (1, 1)], [0.9, 1.1, 0.9]))), max_input=CODE)
    # FixedFunction
    add('ff-GamutComp13Fwd', ctf(op('FixedFunction', 'style="GamutComp13Fwd" params="1.147 1.264 1.312 0.815 0.803 0.88 1.2"', '')))
    add('ff-GamutComp13Rev', ctf(op('FixedFunction', 'style="GamutComp13Rev" params="1.147 1.264 1.312 0.815 0.803 0.88 1.2"', '')))
    add('ff-Rec2100SurroundFwd', ctf(op('FixedFunction', 'style="Rec2100SurroundFwd" params="0.78"', '')))
    add('ff-Rec2100SurroundRev', ctf(op('FixedFunction', 'style="Rec2100SurroundRev" params="0.833333333333333"', '')))
    for style in ('RGB_TO_HSV', 'HSV_TO_RGB', 'RGB_TO_HSY_LIN', 'RGB_TO_HSY_LOG', 'RGB_TO_HSY_VID', 'HSY_LIN_TO_RGB',
                  'HSY_LOG_TO_RGB', 'HSY_VID_TO_RGB', 'XYZ_TO_xyY', 'xyY_TO_XYZ', 'XYZ_TO_uvY', 'uvY_TO_XYZ',
                  'XYZ_TO_LUV', 'LUV_TO_XYZ', 'Lin_TO_PQ', 'PQ_TO_Lin'):
        add(f'ff-{style}', ctf(op('FixedFunction', f'style="{style}"', '')))
    # LUT1D
    curve17 = [(i / 16) ** 0.6 * 1.1 - 0.02 for i in range(17)]
    lut3col = [v for i in range(17) for v in (curve17[i], (i / 16) ** 0.8 * 1.05, (i / 16) ** 1.4)]
    add('lut1d', clf(op('LUT1D', 'interpolation="linear"', array('17 3', lut3col))), ext='clf')
    add('lut1d-1col', ctf(op('LUT1D', '', array('17 1', curve17))))
    add('lut1d-10i', ctf(op('LUT1D', '', array('17 3', [round(v * 1023) for v in lut3col]), depth=('32f', '10i'))))
    add('lut1d-hueAdjust', ctf(op('LUT1D', 'hueAdjust="dw3"', array('17 3', lut3col))))
    add('lut1d-halfDomain', ctf(op('LUT1D', 'halfDomain="true" rawHalfs="true"',
                                   f'        <Array dim="65536 1">\n{" ".join(map(str, half_lut_values()))}\n        </Array>')))
    # LUT3D (blue fastest)
    n = 5
    grid = np.linspace(0, 1, n)
    vals = []
    for r in grid:
        for g in grid:
            for b in grid:
                vals += [r ** 1.2 * 0.9 + 0.05 * g, g ** 0.8 * 0.95 + 0.02 * b - 0.01, b * 0.85 + 0.1 * r * g]
    add('lut3d-tetrahedral', ctf(op('LUT3D', 'interpolation="tetrahedral"', array(f'{n} {n} {n} 3', vals))))
    add('lut3d-trilinear', clf(op('LUT3D', 'interpolation="trilinear"', array(f'{n} {n} {n} 3', vals))), ext='clf')
    add('lut3d-12i', ctf(op('LUT3D', '', array(f'{n} {n} {n} 3', [round(v * 4095) for v in vals]), depth=('32f', '12i'))))
    # .cube (red fastest)
    cube = ['TITLE "fixture"', 'LUT_3D_SIZE 5', 'DOMAIN_MIN -0.1 0 0', 'DOMAIN_MAX 1.2 1 1.5']
    for b in range(n):
        for g in range(n):
            for r in range(n):
                cube.append(' '.join(f'{v:.6f}' for v in vals[3 * (b + n * (g + n * r)): 3 * (b + n * (g + n * r)) + 3]))
    add('cube-3d', '\n'.join(cube) + '\n', ext='cube')
    cube1 = ['LUT_1D_SIZE 17', 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 2 2 2'] + \
            [' '.join(f'{v:.6f}' for v in lut3col[3 * i: 3 * i + 3]) for i in range(17)]
    add('cube-1d', '\n'.join(cube1) + '\n', ext='cube')
    return c


def long_chain(path):
    """roundtrip.py's grade, written by OCIO itself: camera log in, then a grade in log, as a CTF."""
    g = O.GroupTransform()
    g.appendTransform(O.LogCameraTransform(linSideBreak=[0.01125] * 3, base=10.0, logSideSlope=[0.255620723362659] * 3,
                                           logSideOffset=[0.410557184750733] * 3, linSideSlope=[5.26315789473684] * 3,
                                           linSideOffset=[0.0526315789473684] * 3, direction=O.TRANSFORM_DIR_INVERSE))
    m = O.MatrixTransform()
    m.setMatrix([1.05, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0.95, 0, 0, 0, 0, 1])
    g.appendTransform(m)
    g.appendTransform(O.LogCameraTransform(linSideBreak=[0.01125] * 3, base=10.0, logSideSlope=[0.255620723362659] * 3,
                                           logSideOffset=[0.410557184750733] * 3, linSideSlope=[5.26315789473684] * 3,
                                           linSideOffset=[0.0526315789473684] * 3))
    gp = O.GradingPrimary(O.GRADING_LOG)
    gp.brightness = O.GradingRGBM(0.02, 0, -0.02, 0.05)
    gp.contrast = O.GradingRGBM(1, 1, 1, 1.2)
    gp.saturation = 1.1
    gp.pivot = -0.2
    g.appendTransform(O.GradingPrimaryTransform(gp, O.GRADING_LOG, False))
    gt = O.GradingTone(O.GRADING_LOG)
    gt.shadows = O.GradingRGBMSW(1, 1, 1, 0.9, 0.5, 0)
    gt.highlights = O.GradingRGBMSW(1, 1, 1, 1.1, 0.3, 1)
    g.appendTransform(O.GradingToneTransform(gt, O.GRADING_LOG, False))
    c = O.GradingRGBCurve(O.GRADING_LOG)
    c.master = O.GradingBSplineCurve([0, 0, 0.3, 0.27, 0.7, 0.74, 1, 1])
    g.appendTransform(O.GradingRGBCurveTransform(c, O.GRADING_LOG, False))
    hc = O.GradingHueCurve(O.GRADING_LOG)
    hc.hue_sat = O.GradingBSplineCurve([0, 1, 0.33, 1.4, 0.66, 1], O.HueCurveType.HUE_SAT)
    g.appendTransform(O.GradingHueCurveTransform(hc, O.GRADING_LOG, False))
    g.appendTransform(O.CDLTransform(slope=[1.02, 1, 0.98], offset=[0, 0, 0.01], power=[1.1, 1, 1], sat=1.0))
    g.appendTransform(O.FixedFunctionTransform(O.FIXED_FUNCTION_ACES_GAMUT_COMP_13, params=[1.147, 1.264, 1.312, 0.815, 0.803, 0.880, 1.2]))
    g.write(formatName='Color Transform Format', fileName=path, config=CFG)


def number(v):
    """A float32 as JSON: 9 significant digits round-trip it; NaN and infinities (JSON has none) as strings."""
    if np.isnan(v):
        return 'NaN'
    if np.isinf(v):
        return 'Infinity' if v > 0 else '-Infinity'
    return float(f'{v:.9g}')


def rows(a):
    return [[number(v) for v in row] for row in a.tolist()]


def main():
    os.makedirs(OPS_DIR, exist_ok=True)
    for old in glob.glob(os.path.join(OPS_DIR, '*')):
        os.remove(old)
    rgb = inputs()
    out = {'inputs': rows(rgb), 'cases': []}
    all_cases = cases()
    long_path = os.path.join(OPS_DIR, 'long-chain.ctf')
    long_chain(long_path)
    for name, file, text, tol, max_input in all_cases:
        path = os.path.join(OPS_DIR, file)
        with open(path, 'w') as f:
            f.write(text)
    all_cases.append(('long-chain', 'long-chain.ctf', None, FAST_POW, CODE))
    for name, file, text, tol, max_input in all_cases:
        res = run_file(os.path.join(OPS_DIR, file), rgb)
        case = {'name': name, 'file': file, 'tolerance': tol, 'outputs': rows(res)}
        if max_input is not None:
            case['maxInput'] = max_input
        out['cases'].append(case)
    # The half-domain LUT is 400 KB of text: the test builds it, so it is not kept.
    os.remove(os.path.join(OPS_DIR, 'lut1d-halfDomain.ctf'))
    with open(os.path.join(FIXTURES, 'ops.json'), 'w') as f:
        json.dump(out, f, separators=(',', ':'))

    # OpenFilm's transforms take code values (an input transform) or ACEScct (the output transform): inputs up to 1.
    # Camera curves decode to linear values in the hundreds, which OCIO holds in single precision, and the ACEScct toe
    # (slope 10.5) magnifies what a gamut matrix leaves of them: 2e-5 relative. The ACES 2.0 Output Transform is
    # aces2.mjs's port; files that use it are held to 1e-4.
    tr = {'inputs': rows(rgb), 'cases': []}
    for path in sorted(glob.glob(os.path.join(ROOT, 'transforms', '*.ctf'))):
        aces2 = 'ACESOutputTransform20' in open(path).read()
        tol = {'abs': 1e-4 if aces2 else 1e-5, 'rel': 2e-5}
        tr['cases'].append({'file': os.path.basename(path), 'tolerance': tol, 'maxInput': 1, 'outputs': rows(run_file(path, rgb))})
    with open(os.path.join(FIXTURES, 'transforms.json'), 'w') as f:
        json.dump(tr, f, separators=(',', ':'))
    print(f'{len(out["cases"])} op fixtures, {len(tr["cases"])} transforms, {len(rgb)} inputs')


if __name__ == '__main__':
    main()
