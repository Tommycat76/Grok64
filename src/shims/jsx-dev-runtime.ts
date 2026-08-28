/**
 * Production-safe stand-in for `react/jsx-dev-runtime`.
 * Extra jsxDEV arguments (source location, self) are ignored.
 */
export { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { jsx, jsxs } from "react/jsx-runtime";

export function jsxDEV(
  type: Parameters<typeof jsx>[0],
  props: Parameters<typeof jsx>[1],
  key?: Parameters<typeof jsx>[2],
  isStaticChildren?: boolean,
): ReturnType<typeof jsx> {
  return isStaticChildren ? jsxs(type, props, key) : jsx(type, props, key);
}
