// @ts-check

/**
 * A frame rate as it really is. The NTSC rates 23.976, 29.97 and 59.94 (and 47.952, 119.88) are a whole rate slowed
 * by 1000/1001: exactly 24000/1001, 30000/1001 and 60000/1001, so a render's frames, its encoder's rate and the
 * file's rate tag match footage shot at them. Another rate is kept as it is, as num/1.
 * @param {number} fps @returns {{ fps: number, num: number, den: number }}
 */
export function exactRate(fps) {
  const whole = Math.round(fps);
  const ntsc = whole > 0 && Math.abs(fps - whole) > 0.001 && Math.abs(fps - (whole * 1000) / 1001) < 0.01;
  return ntsc ? { fps: (whole * 1000) / 1001, num: whole * 1000, den: 1001 } : { fps, num: fps, den: 1 };
}

/** A number as ffmpeg reads it. A rate times over is a small number, so a float's tail (1.1 * 3 written as
 * 3.3000000000000003) is never a real part of it: round it away before it reaches `-r`, `-framerate` or a filter.
 * @param {number} n */
const plain = (n) => String(Number(n.toPrecision(12)));

/** The rate as ffmpeg takes it (`-r`, `-framerate`, a filter's expression), `times` over. @param {{ num: number, den: number }} rate @param {number} [times] */
export const ffmpegRate = ({ num, den }, times = 1) => (den === 1 ? plain(num * times) : `${plain(num * times)}/${den}`);
