import React from 'react';

import type { voicePalette } from '@/lib/library-voices';
import styles from './AudioArtwork.module.css';

type Palette = ReturnType<typeof voicePalette>;
type Rgb = [number, number, number];

const vertex = `
attribute vec2 point;
void main() { gl_Position = vec4(point, 0., 1.); }
`;

const fragment = `
precision highp float;
uniform vec2 size;
uniform float time;
uniform float energy;
uniform vec3 base;
uniform vec3 spotColor[4];
uniform vec3 spotGeometry[4];

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * .1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.-2.*f);
  return mix(mix(hash(i), hash(i+vec2(1.,0.)), f.x),
             mix(hash(i+vec2(0.,1.)), hash(i+1.), f.x), f.y);
}

float fog(vec2 p) {
  mat2 turn = mat2(.81, .59, -.59, .81);
  float v = .54*noise(p);
  p = turn*p*2.06+12.3;
  v += .25*noise(p);
  p = turn*p*2.03+5.2;
  v += .13*noise(p);
  p = turn*p*2.01+8.4;
  return v + .065*noise(p);
}

// The CSS avatar uses a circle with the farthest-corner radius for each gradient.
vec3 avatar(vec2 uv) {
  vec3 color = base;
  for (int i = 3; i >= 0; i--) {
    vec3 spot = spotGeometry[i];
    vec2 farCorner = max(spot.xy, 1.-spot.xy);
    float spread = length(farCorner)*spot.z;
    float alpha = 1.-clamp(distance(uv, spot.xy)/spread, 0., 1.);
    color = mix(color, spotColor[i], alpha);
  }
  return color;
}

void main() {
  vec2 p = (2.*gl_FragCoord.xy-size)/min(size.x,size.y);
  float dist = length(p);
  float r = .824+.067*energy;
  float aa = 1.5/min(size.x,size.y);
  float shell = 1.-smoothstep(r-aa,r+aa,dist);
  float halo = .075*exp(-max(0.,dist-r)*24.);
  if (dist > r+.16) { gl_FragColor = vec4(0.); return; }

  vec2 q = p/r;
  vec2 uv = .5+.5*vec2(q.x,-q.y);
  vec3 color = avatar(uv);
  if (energy > .001) {
    vec2 light = spotGeometry[3].xy;
    vec2 seed = spotGeometry[1].xy*17.;
    float t = time*.44;
    vec2 pos = (uv-light)*3.2;
    vec2 wind = vec2(fog(pos+seed+vec2(-t,.45*t)), fog(pos-seed+vec2(.35*t,-.72*t)))-.5;
    vec2 flow = uv+energy*wind*.4;
    float cloud = fog(pos+seed+wind+vec2(-t*.64,t*.13));
    float edge = distance(flow,light)-spotGeometry[3].z*.72+(cloud-.5)*.35;
    float haze = 1.-smoothstep(-.12,.32,edge);
    vec3 bright = mix(spotColor[3], vec3(.99,.98,1.), .7);
    color = mix(avatar(flow), bright, energy*haze*.55);
  }
  gl_FragColor = vec4(mix(spotColor[1],color,shell), mix(halo,1.,shell));
}
`;

// The stable avatar colors are HSL strings; convert once per voice for the shader.
function rgb(hsl: string): Rgb {
  const values = hsl.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const h = values[0] ?? 0, s = (values[1] ?? 0) / 100, l = (values[2] ?? 0) / 100;
  const a = s * Math.min(l, 1 - l);
  const at = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [at(0), at(8), at(4)];
}

function createRenderer(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: false });
  if (!gl) return null;
  const program = gl.createProgram();
  const buffer = gl.createBuffer();
  const vert = gl.createShader(gl.VERTEX_SHADER);
  const frag = gl.createShader(gl.FRAGMENT_SHADER);
  const destroy = () => {
    gl.deleteShader(vert);
    gl.deleteShader(frag);
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
  };
  if (!program || !buffer || !vert || !frag) { destroy(); return null; }
  gl.shaderSource(vert, vertex);
  gl.shaderSource(frag, fragment);
  gl.compileShader(vert);
  gl.compileShader(frag);
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { destroy(); return null; }
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const point = gl.getAttribLocation(program, 'point');
  gl.enableVertexAttribArray(point);
  gl.vertexAttribPointer(point, 2, gl.FLOAT, false, 0, 0);
  const uniform = (key: string) => gl.getUniformLocation(program, key);
  const size = uniform('size'), time = uniform('time'), energy = uniform('energy');
  const base = uniform('base');
  const colors = uniform('spotColor[0]');
  const geometry = uniform('spotGeometry[0]');
  return {
    destroy,
    setPalette: (palette: Palette) => {
      gl.uniform3fv(base, rgb(palette.base));
      gl.uniform3fv(colors, palette.spots.flatMap(({ color }) => rgb(color)));
      gl.uniform3fv(geometry, palette.spots.flatMap(({ x, y, radius }) => [x / 100, y / 100, radius / 100]));
    },
    draw: (clock: number, level: number) => {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(size, canvas.width, canvas.height);
      gl.uniform1f(time, clock);
      gl.uniform1f(energy, level);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}

/** Procedural fog driven by the preview waveform inside a circle that expands with the sound. */
export const VoiceOrbCanvas = React.memo(function VoiceOrbCanvas({ palette, playing, readLevel, children }: {
  palette: Palette;
  playing: boolean;
  readLevel?: () => number;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const renderer = React.useRef<ReturnType<typeof createRenderer>>(null);
  const refresh = React.useRef<(() => void) | null>(null);
  const state = React.useRef({ palette, playing, readLevel });

  React.useLayoutEffect(() => {
    state.current = { palette, playing, readLevel };
    renderer.current?.setPalette(palette);
    refresh.current?.();
  }, [palette, playing, readLevel]);

  React.useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const fallback = canvas.nextElementSibling as HTMLElement | null;
    let frame = 0, previous = 0, clock = 0, level = 0, shown = -1;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const draw = (now: number) => {
      frame = 0;
      const { playing: audible, readLevel: read } = state.current;
      const dt = previous ? Math.min(50, Math.max(0, now - previous)) : 16.7;
      previous = now;
      const active = audible && !motion.matches && !document.hidden;
      const goal = active ? Math.min(1, Math.sqrt((read?.() ?? 0) * 3.2)) : 0;
      level += (goal - level) * (1 - Math.exp(-dt / (goal > level ? 42 : 145)));
      if (level < .006 && goal === 0) level = 0;
      if (active) clock += dt * .001 * (.67 + .8*level);
      if (motion.matches) level = 0;
      renderer.current?.draw(clock, level);
      const percent = Math.round(level * 100);
      if (percent !== shown) {
        canvas.dataset.energy = String(percent);
        shown = percent;
      }
      if (!renderer.current) fallback?.style.setProperty('--voice-level', String(level));
      if (!document.hidden && (active || level > 0)) frame = requestAnimationFrame(draw);
      else previous = 0;
    };
    const repaint = () => { cancelAnimationFrame(frame); draw(performance.now()); };
    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      if (!width || !height) return;
      const pixels = (n: number) => Math.max(1, Math.min(400, Math.round(n * Math.min(devicePixelRatio, 2))));
      const w = pixels(width), h = pixels(height);
      if (w !== canvas.width || h !== canvas.height) { canvas.width = w; canvas.height = h; }
      repaint();
    };
    const init = () => {
      try { renderer.current = createRenderer(canvas); } catch { renderer.current = null; }
      if (renderer.current) {
        renderer.current.setPalette(state.current.palette);
        canvas.dataset.ready = '';
      }
      resize();
    };
    const lost = (event: Event) => {
      event.preventDefault();
      cancelAnimationFrame(frame);
      renderer.current = null;
      delete canvas.dataset.ready;
      repaint();
    };
    init();
    refresh.current = repaint;
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    motion.addEventListener('change', repaint);
    document.addEventListener('visibilitychange', repaint);
    canvas.addEventListener('webglcontextlost', lost);
    canvas.addEventListener('webglcontextrestored', init);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      motion.removeEventListener('change', repaint);
      document.removeEventListener('visibilitychange', repaint);
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', init);
      renderer.current?.destroy();
      renderer.current = null;
      refresh.current = null;
      delete canvas.dataset.ready;
      delete canvas.dataset.energy;
    };
  }, []);

  return <><canvas ref={ref} data-voice-orb="" className={styles.orbCanvas} aria-hidden="true" />{children}</>;
});
