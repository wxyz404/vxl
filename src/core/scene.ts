/** Mean RGB difference, ignoring alpha. Inputs are equally sized thumbnail pixels. */
export function sceneDifference(previous: Uint8ClampedArray, current: Uint8ClampedArray): number {
  if (previous.length !== current.length || !current.length) return 1;
  let difference = 0;
  for (let i = 0; i < current.length; i += 4) {
    difference += Math.abs(current[i] - previous[i]) + Math.abs(current[i + 1] - previous[i + 1]) + Math.abs(current[i + 2] - previous[i + 2]);
  }
  return difference / (current.length / 4 * 3 * 255);
}
