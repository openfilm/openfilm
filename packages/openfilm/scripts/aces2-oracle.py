"""
The fixtures of src/color/aces2.test.mjs: OpenColorIO 2.6's own ACES 2.0 Output Transform (the FixedFunction styles
ACESOutputTransform20Fwd and ACESOutputTransform20Inv, its CPU path) run on seeded random values, written to
src/color/fixtures/aces2/<case>.json as { params, forward: { inputs, outputs }, inverse: { inputs, outputs } }, each
a flat list of RGB triples. The tests read these files; they never run this script.

Run it from anywhere, with PyOpenColorIO 2.6 and NumPy installed:

    python3 -m venv /tmp/ocio && /tmp/ocio/bin/pip install opencolorio==2.6.0 numpy
    /tmp/ocio/bin/python packages/openfilm/scripts/aces2-oracle.py
"""

import json
import os

import numpy as np
import PyOpenColorIO as OCIO

assert OCIO.__version__.startswith('2.6'), f'needs OpenColorIO 2.6, found {OCIO.__version__}'

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'color', 'fixtures', 'aces2')

REC709 = [0.64, 0.33, 0.30, 0.60, 0.15, 0.06, 0.3127, 0.3290]
P3_D65 = [0.680, 0.320, 0.265, 0.690, 0.150, 0.060, 0.3127, 0.3290]
REC2020 = [0.708, 0.292, 0.170, 0.797, 0.131, 0.046, 0.3127, 0.3290]

# the params as a CTF carries them: peak nits, then the limiting primaries and white
CASES = {
    'sdr-100-rec709': [100] + REC709,
    'sdr-100-p3d65': [100] + P3_D65,
    'hdr-1000-p3d65': [1000] + P3_D65,
    'hdr-1000-rec2020': [1000] + REC2020,
}

cfg = OCIO.Config.CreateRaw()


def run(params, direction, rgb):
    t = OCIO.FixedFunctionTransform(OCIO.FIXED_FUNCTION_ACES_OUTPUT_TRANSFORM_20, params=params, direction=direction)
    out = np.ascontiguousarray(rgb, dtype=np.float32).copy()
    cfg.getProcessor(t).getDefaultCPUProcessor().applyRGB(out)
    return out


def scene_values(rng):
    """ACES2065-1 values: ordinary, over a wide range, very bright, very saturated, negative, and a few fixed ones."""
    ordinary = rng.uniform(0, 1.5, (100, 3))
    wide = 2.0 ** rng.uniform(-12, 12, (100, 1)) * rng.uniform(0, 1, (100, 3))
    bright = 2.0 ** rng.uniform(8, 15.9, (30, 1)) * rng.uniform(0.2, 1, (30, 3))
    # one or two channels at (or near) zero, the others bright
    saturated = 2.0 ** rng.uniform(-4, 10, (40, 1)) * rng.uniform(0.5, 1, (40, 3))
    for i, row in enumerate(saturated):
        row[rng.choice(3, size=1 + i % 2, replace=False)] = rng.choice([0.0, 1e-4, -1e-3])
    negative = rng.uniform(-0.5, 1, (40, 3))
    negative[:8] = -rng.uniform(0, 2, (8, 3))
    fixed = np.array([
        [0, 0, 0], [0.18, 0.18, 0.18], [1, 1, 1], [16, 16, 16], [1000, 1000, 1000],
        [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [0, 1, 1], [1, 0, 1],
        [0.0001, 0.0001, 0.0001], [65504, 0, 0], [0, 0, 65504], [-0.1, 0.18, 0.18],
    ])
    return np.concatenate([fixed, ordinary, wide, bright, saturated, negative])


def display_values(rng, peak):
    """Display values: inside the cube up to peak, on its faces, and a few outside it."""
    top = peak / 100
    inside = rng.uniform(0, top, (150, 3))
    faces = rng.uniform(0, top, (30, 3))
    for i, row in enumerate(faces):
        row[i % 3] = 0 if i % 2 else top
    outside = rng.uniform(-0.05, top * 1.05, (20, 3))
    fixed = np.array([[0, 0, 0], [top, top, top], [0.1, 0.1, 0.1], [top, 0, 0], [0, top, 0], [0, 0, top]])
    return np.concatenate([fixed, inside, faces, outside])


def flat(a):
    # float32 values written with 9 significant digits read back as the same float32
    return [float(f'{v:.9g}') for v in np.asarray(a, dtype=np.float32).ravel()]


os.makedirs(OUT, exist_ok=True)
for seed, (name, params) in enumerate(CASES.items()):
    rng = np.random.default_rng(2026 + seed)
    scene = scene_values(rng).astype(np.float32)
    display = display_values(rng, params[0]).astype(np.float32)
    fixture = {
        'params': params,
        'forward': {'inputs': flat(scene), 'outputs': flat(run(params, OCIO.TRANSFORM_DIR_FORWARD, scene))},
        'inverse': {'inputs': flat(display), 'outputs': flat(run(params, OCIO.TRANSFORM_DIR_INVERSE, display))},
    }
    with open(os.path.join(OUT, f'{name}.json'), 'w') as f:
        json.dump(fixture, f, separators=(',', ':'))
        f.write('\n')
    print(name, len(scene), 'forward,', len(display), 'inverse')
