/**
 * Shallow equality for plain record-like objects.
 */
export function shallowEqualRecord(
  left: Record<string, unknown> | undefined,
  right: Record<string, unknown> | undefined
): boolean {
  if (left === right) {
    return true;
  }

  if (left === undefined || right === undefined) {
    return false;
  }

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);

  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) {
      return false;
    }

    if (!Object.is(left[key], right[key])) {
      return false;
    }
  }

  return true;
}
