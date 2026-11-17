"""OpenFilm's color management transforms, written as OpenColorIO CTF files into src/color/transforms/.

Each graded clip's --of-lut (SPEC.md) runs: an input transform (its footage into the working space, ACEScct), the
grade's own files, then the project's output transform (ACEScct to the display). The input and output transforms are
these files. They are made once, here, with OpenColorIO itself, and kept in the repository: OpenFilm never runs this.

  out-rec709.ctf     ACEScct to an SDR Rec.709 display: the ACES 2.0 Output Transform (100 nit), Rec.1886 encoding
  in-rec709.ctf      its exact inverse: SDR footage into ACEScct, so a clip with nothing graded looks as it was
  in-<camera>.ctf    a camera's log footage into ACEScct (a video-range file; `-full` for a full-range one where the
                     maker's curve is written on the stored code)

Cameras OpenColorIO knows (Apple, ARRI, Canon, Panasonic, Sony) come from its built-in transforms; the others from
their makers' published curves (the same constants as the earlier engine, each checked against the maker's table).
A curve OpenColorIO writes as a very long 1D table is sampled again at 4096 points: the files stay small and the error
stays far under one 10-bit code (checked below).

Run with PyOpenColorIO 2.6: `python3 packages/openfilm/scripts/color-transforms.py` (needs numpy).
"""
import math, os, re, sys
import numpy as np
import PyOpenColorIO as O

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'color', 'transforms')
CFG = O.Config.CreateRaw()
FWD, INV = O.TRANSFORM_DIR_FORWARD, O.TRANSFORM_DIR_INVERSE
B = lambda name, d=FWD: O.BuiltinTransform(name, d)
TO_CCT = B('ACEScct_to_ACES2065-1', INV)
FROM_CCT = B('ACEScct_to_ACES2065-1')
SAMPLES = 4096


def processor(transforms, direction=FWD):
    g = O.GroupTransform()
    for t in transforms:
        g.appendTransform(t)
    return CFG.getProcessor(g, direction).getOptimizedProcessor(O.OPTIMIZATION_DEFAULT)


def apply(proc, rgb):
    a = np.ascontiguousarray(rgb, dtype=np.float32).copy()
    proc.getDefaultCPUProcessor().applyRGB(a)
    return a


def write(name, group, description):
    path = os.path.join(OUT, f'{name}.ctf')
    group.getFormatMetadata().addChildElement('Description', description)
    group.write(formatName='Color Transform Format', fileName=path, config=CFG)
    text = open(path).read()
    # a stable id: the file's name, not a random one each run
    text = re.sub(r'id="urn:uuid:[^"]*"', f'id="openfilm:{name}"', text, count=1)
    open(path, 'w').write(text)
    return path


def resampled(group):
    """The same transforms with each long 1D table sampled again at SAMPLES points over its input range."""
    out = O.GroupTransform()
    for t in group:
        if isinstance(t, O.Lut1DTransform) and t.getLength() > SAMPLES:
            p = CFG.getProcessor(t)
            x = np.linspace(0, 1, SAMPLES, dtype=np.float32)
            y = apply(p, np.stack([x, x, x], 1))
            lut = O.Lut1DTransform(length=SAMPLES)
            for k in range(SAMPLES):
                lut.setValue(k, float(y[k, 0]), float(y[k, 1]), float(y[k, 2]))
            out.appendTransform(lut)
        else:
            out.appendTransform(t)
    return out


def pq_curve(group):
    """The same transforms with PQ's long 1D table (code to light) as the standard function it samples."""
    out = O.GroupTransform()
    for t in group:
        if isinstance(t, O.Lut1DTransform):
            out.appendTransform(O.FixedFunctionTransform(O.FIXED_FUNCTION_LIN_TO_PQ, direction=INV))
        else:
            out.appendTransform(t)
    return out


def check(name, want, got, tolerance):
    """Two processors give the same ACEScct for every code value, within `tolerance` of a 10-bit code."""
    x = np.linspace(0, 1, 4096, dtype=np.float32)
    rgb = np.stack([x, np.roll(x, 1365), np.roll(x, 2730)], 1)
    err = float(np.abs(apply(want, rgb) - apply(got, rgb)).max()) * 1023
    print(f'  {name:24s} max {err:.4f} of a 10-bit code')
    if err > tolerance:
        sys.exit(f'{name}: {err} codes off (more than {tolerance})')


# ---- output, and SDR input as its inverse
OUTPUT = [FROM_CCT, B('ACES-OUTPUT - ACES2065-1_to_CIE-XYZ-D65 - SDR-100nit-REC709_2.0'), B('DISPLAY - CIE-XYZ-D65_to_REC.1886-REC.709')]


# ---- cameras' curves (a code value from 0 to 1 to scene light), as the makers publish them
def apple_log(p):
    R0, Rt, c, b, g, d = -0.05641088, 0.01, 47.28711236, 0.00964052, 0.08550479, 0.69336945
    pt = c * (Rt - R0) ** 2
    return 2 ** ((p - d) / g) - b if p >= pt else (math.sqrt(p / c) + R0 if p >= 0 else R0)


def dji_dlog(y):
    return (y - 0.0929) / 6.025 if y <= 0.14 else (10 ** ((y - 0.584555) / 0.256663) - 0.0108) / 0.9892


def fujifilm(a, b, c, d, e, f, cut2):
    return lambda v: 10 ** ((v - d) / c) / a - b / a if v >= cut2 else (v - f) / e


def nikon_nlog(v):
    x = v * 1023
    return (x / 650) ** 3 - 0.0075 if x < 452 else math.exp((x - 619) / 150)


def bmd_film5(y):
    A, Bc, C, D, E, cut = 0.08692876065491224, 0.005494072432257808, 0.5300133392291939, 8.283605932402494, 0.09246575342465753, 0.005
    return (y - E) / D if y < D * cut + E else math.exp((y - C) / A) - Bc


D65 = (0.3127, 0.3290)
GAMUTS = {
    'bt2020': ((0.708, 0.292), (0.170, 0.797), (0.131, 0.046)),
    'dgamut': ((0.71, 0.31), (0.21, 0.88), (0.09, -0.08)),
    'bmdwg': ((0.7177215, 0.3171181), (0.2280410, 0.8615690), (0.1005841, -0.0820452)),
}


def to_xyz(primaries, white=D65):
    m = np.array([[x / y, 1, (1 - x - y) / y] for x, y in primaries]).T
    w = np.array([white[0] / white[1], 1, (1 - white[0] - white[1]) / white[1]])
    return m * np.linalg.solve(m, w)


AP0 = ((0.7347, 0.2653), (0.0, 1.0), (0.0001, -0.0770))
ACES_WHITE = (0.32168, 0.33767)
BRADFORD = np.array([[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]])


def adapt(src, dst):
    xyz = lambda w: np.array([w[0] / w[1], 1, (1 - w[0] - w[1]) / w[1]])
    s, d = BRADFORD @ xyz(src), BRADFORD @ xyz(dst)
    return np.linalg.inv(BRADFORD) @ np.diag(d / s) @ BRADFORD


def to_aces(gamut):
    """A D65 camera gamut into ACES2065-1 (AP0, ACES white), Bradford-adapted as OpenColorIO's camera transforms are."""
    return np.linalg.inv(to_xyz(AP0, ACES_WHITE)) @ adapt(D65, ACES_WHITE) @ to_xyz(GAMUTS[gamut])


def signal_to_code():
    """A video-range file's signal (0 at black's code, 1 at white's) back to the stored 10-bit code over 1023."""
    r = O.RangeTransform(minInValue=0, maxInValue=1, minOutValue=64 / 1023, maxOutValue=940 / 1023)
    r.setStyle(O.RANGE_NO_CLAMP)
    return r


def from_formula(curve, gamut, cv):
    """A camera's curve as a 1D table, its gamut into ACES2065-1, then ACEScct. `cv`: the curve is written on the stored
    10-bit code, so a video-range file's signal is first taken back to that code."""
    g = O.GroupTransform()
    if cv:
        g.appendTransform(signal_to_code())
    lut = O.Lut1DTransform(length=SAMPLES)
    for k in range(SAMPLES):
        v = curve(k / (SAMPLES - 1))
        lut.setValue(k, v, v, v)
    g.appendTransform(lut)
    m = to_aces(gamut)
    g.appendTransform(O.MatrixTransform(matrix=[*m[0], 0, *m[1], 0, *m[2], 0, 0, 0, 0, 1]))
    g.appendTransform(TO_CCT)
    return g


def video_range_cv(builtin):
    """OpenColorIO's camera transform, for a video-range file whose maker writes the curve on the stored code."""
    return [signal_to_code(), builtin]


def main():
    os.makedirs(OUT, exist_ok=True)
    written = []
    out = processor(OUTPUT)
    written.append(write('out-rec709', out.createGroupTransform(), 'OpenFilm output: ACEScct to an SDR Rec.709 display (ACES 2.0 Output Transform, 100 nit, Rec.1886)'))
    back = processor(OUTPUT, INV)
    written.append(write('in-rec709', back.createGroupTransform(), 'OpenFilm input: SDR Rec.709 footage into ACEScct (the exact inverse of out-rec709)'))
    # HDR footage is display-referred: back through ACES 2.0's own 1000 nit Rec.2020 rendering, as HLG or PQ shows it
    hdr = B('ACES-OUTPUT - ACES2065-1_to_CIE-XYZ-D65 - HDR-1000nit-REC2020_2.0')
    for name, label, display in (('hlg', 'HLG (Rec.2100, 1000 nit)', 'DISPLAY - CIE-XYZ-D65_to_REC.2100-HLG-1000nit'), ('pq', 'PQ (Rec.2100, ST 2084)', 'DISPLAY - CIE-XYZ-D65_to_REC.2100-PQ')):
        p = processor([FROM_CCT, hdr, B(display)], INV)
        g = resampled(p.createGroupTransform()) if name == 'hlg' else pq_curve(p.createGroupTransform())
        # OpenColorIO's PQ function and its own table differ by up to 0.2 % of the light (at 10 000 nit; under 0.1 %
        # below 1000): a few codes of ACEScct at the very top, gone in an SDR rendering, for a file 900 KB smaller
        check(f'{name} (resampled)', p, CFG.getProcessor(g), 0.25 if name == 'hlg' else 4)
        written.append(write(f'in-{name}', g, f'OpenFilm input: {label} HDR footage into ACEScct (the inverse of ACES 2.0 HDR 1000 nit Rec.2020)'))
    # round trip: SDR in, then out, is the identity
    x = np.linspace(0, 1, 1024, dtype=np.float32)
    rgb = np.stack([x, np.roll(x, 300), np.roll(x, 700)], 1)
    trip = apply(out, apply(back, rgb))
    print(f'  rec709 round trip        max {float(np.abs(trip - rgb).max()) * 1023:.4f} of a 10-bit code')

    builtins = {
        'apple-log': ('Apple Log', [B('APPLE_LOG_to_ACES2065-1')]),
        'apple-log-2': ('Apple Log 2 (Apple Wide Gamut)', [B('APPLE_LOG-APPLEWG_to_ACES2065-1')]),
        'arri-logc3': ('ARRI LogC3 (EI 800), ALEXA Wide Gamut', [B('ARRI_ALEXA-LOGC-EI800-AWG_to_ACES2065-1')]),
        'arri-logc4': ('ARRI LogC4, ARRI Wide Gamut 4', [B('ARRI_LOGC4_to_ACES2065-1')]),
        'canon-clog3': ('Canon Log 3, Cinema Gamut', [B('CANON_CLOG3-CGAMUT_to_ACES2065-1')]),
    }
    for name, (label, ts) in builtins.items():
        p = processor(ts + [TO_CCT])
        g = resampled(p.createGroupTransform())
        check(name, p, CFG.getProcessor(g), 0.05)
        written.append(write(f'in-{name}', g, f'OpenFilm input: {label} footage into ACEScct'))
    # makers who write their curve on the stored code: a video-range file (the usual), and a full-range one
    coded = {
        'sony-slog3': ('Sony S-Log3, S-Gamut3.Cine', B('SONY_SLOG3-SGAMUT3.CINE_to_ACES2065-1')),
        'sony-slog3-sgamut3': ('Sony S-Log3, S-Gamut3', B('SONY_SLOG3-SGAMUT3_to_ACES2065-1')),
        'panasonic-vlog': ('Panasonic V-Log, V-Gamut', B('PANASONIC_VLOG-VGAMUT_to_ACES2065-1')),
    }
    for name, (label, t) in coded.items():
        for full in (False, True):
            p = processor(([t] if full else video_range_cv(t)) + [TO_CCT])
            g = resampled(p.createGroupTransform())
            check(name + ('-full' if full else ''), p, CFG.getProcessor(g), 0.05)
            written.append(write(f'in-{name}{"-full" if full else ""}', g, f'OpenFilm input: {label} footage ({"a full-range" if full else "a video-range"} file) into ACEScct'))
    formulas = {
        'fujifilm-flog': ('Fujifilm F-Log', fujifilm(0.555556, 0.009468, 0.344676, 0.790453, 8.735631, 0.092864, 0.100537775223865), 'bt2020'),
        'fujifilm-flog2': ('Fujifilm F-Log2', fujifilm(5.555556, 0.064829, 0.245281, 0.384316, 8.799461, 0.092864, 0.100686685370811), 'bt2020'),
        'nikon-nlog': ('Nikon N-Log', nikon_nlog, 'bt2020'),
        'dji-dlog': ('DJI D-Log, D-Gamut', dji_dlog, 'dgamut'),
    }
    for name, (label, curve, gamut) in formulas.items():
        for full in (False, True):
            g = from_formula(curve, gamut, cv=not full)
            written.append(write(f'in-{name}{"-full" if full else ""}', g, f'OpenFilm input: {label} footage ({"a full-range" if full else "a video-range"} file) into ACEScct'))
    g = from_formula(bmd_film5, 'bmdwg', cv=False)
    written.append(write('in-bmd-film5', g, 'OpenFilm input: Blackmagic Film Gen 5, Wide Gamut footage into ACEScct'))
    # the formula path against OpenColorIO's own, on a camera both have: Apple Log
    check('formula vs OCIO (Apple)', processor([B('APPLE_LOG_to_ACES2065-1'), TO_CCT]), CFG.getProcessor(from_formula(apple_log, 'bt2020', cv=False)), 0.5)
    for path in written:
        print(f'  {os.path.basename(path):32s} {os.path.getsize(path):>8} bytes')


if __name__ == '__main__':
    main()
