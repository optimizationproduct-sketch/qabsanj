import type { Section } from "./sections.ts";
import { E, G } from "./frame-types.ts";

export function localK(sec: Section, L: number, truss: boolean) {
  const k = new Float64Array(144);
  const put = (i: number, j: number, v: number) => {
    k[i * 12 + j] = v;
  };
  const ea = (E * sec.A) / L;
  put(0, 0, ea);
  put(0, 6, -ea);
  put(6, 0, -ea);
  put(6, 6, ea);
  if (truss) return k;
  const gj = (G * Math.max(sec.J, sec.Iy * 1e-4)) / L;
  put(3, 3, gj);
  put(3, 9, -gj);
  put(9, 3, -gj);
  put(9, 9, gj);
  const iz = E * sec.Iz;
  const iy = E * sec.Iy;
  const L2 = L * L;
  const L3 = L2 * L;
  const a = (12 * iz) / L3;
  const b = (6 * iz) / L2;
  const c = (4 * iz) / L;
  const d = (2 * iz) / L;
  put(1, 1, a);
  put(1, 5, b);
  put(1, 7, -a);
  put(1, 11, b);
  put(5, 1, b);
  put(5, 5, c);
  put(5, 7, -b);
  put(5, 11, d);
  put(7, 1, -a);
  put(7, 5, -b);
  put(7, 7, a);
  put(7, 11, -b);
  put(11, 1, b);
  put(11, 5, d);
  put(11, 7, -b);
  put(11, 11, c);
  const a2 = (12 * iy) / L3;
  const b2 = (6 * iy) / L2;
  const c2 = (4 * iy) / L;
  const d2 = (2 * iy) / L;
  put(2, 2, a2);
  put(2, 4, -b2);
  put(2, 8, -a2);
  put(2, 10, -b2);
  put(4, 2, -b2);
  put(4, 4, c2);
  put(4, 8, b2);
  put(4, 10, d2);
  put(8, 2, -a2);
  put(8, 4, b2);
  put(8, 8, a2);
  put(8, 10, b2);
  put(10, 2, -b2);
  put(10, 4, d2);
  put(10, 8, b2);
  put(10, 10, c2);
  return k;
}

export function applyR(R: Float64Array, v: ArrayLike<number>, transp: boolean) {
  const o = new Float64Array(12);
  for (let n = 0; n < 4; n++) {
    const b = n * 3;
    if (!transp) {
      o[b] = R[0] * v[b] + R[1] * v[b + 1] + R[2] * v[b + 2];
      o[b + 1] = R[3] * v[b] + R[4] * v[b + 1] + R[5] * v[b + 2];
      o[b + 2] = R[6] * v[b] + R[7] * v[b + 1] + R[8] * v[b + 2];
    } else {
      o[b] = R[0] * v[b] + R[3] * v[b + 1] + R[6] * v[b + 2];
      o[b + 1] = R[1] * v[b] + R[4] * v[b + 1] + R[7] * v[b + 2];
      o[b + 2] = R[2] * v[b] + R[5] * v[b + 1] + R[8] * v[b + 2];
    }
  }
  return o;
}

export function mulK(k: Float64Array, v: ArrayLike<number>) {
  const o = new Float64Array(12);
  for (let i = 0; i < 12; i++) {
    let s = 0;
    const row = i * 12;
    for (let j = 0; j < 12; j++) s += k[row + j] * v[j];
    o[i] = s;
  }
  return o;
}

export function toGlobalK(kL: Float64Array, R: Float64Array) {
  const Kg = new Float64Array(144);
  const ej = new Float64Array(12);
  for (let j = 0; j < 12; j++) {
    ej[j] = 1;
    const col = applyR(R, mulK(kL, applyR(R, ej, false)), true);
    for (let i = 0; i < 12; i++) Kg[i * 12 + j] = col[i];
    ej[j] = 0;
  }
  return Kg;
}

export function equiv(qx: number, qy: number, qz: number, L: number, truss: boolean) {
  const q = new Float64Array(12);
  q[0] = (qx * L) / 2;
  q[6] = (qx * L) / 2;
  q[1] = (qy * L) / 2;
  q[7] = (qy * L) / 2;
  q[2] = (qz * L) / 2;
  q[8] = (qz * L) / 2;
  if (!truss) {
    const L2 = L * L;
    q[5] = (qy * L2) / 12;
    q[11] = (-qy * L2) / 12;
    q[4] = (-qz * L2) / 12;
    q[10] = (qz * L2) / 12;
  }
  return q;
}

export function cholesky(A: Float64Array, n: number): string | null {
  let scale = 0;
  for (let i = 0; i < n; i++) scale = Math.max(scale, Math.abs(A[i * n + i]));
  const tol = Math.max(scale, 1) * 1e-12;
  for (let k = 0; k < n; k++) {
    let s = A[k * n + k];
    for (let j = 0; j < k; j++) s -= A[k * n + j] * A[k * n + j];
    if (s <= tol) return "ماتریس سختی منفرد است؛ سازه مکانیزم دارد یا بیش از حد لاغر است.";
    const lkk = Math.sqrt(s);
    A[k * n + k] = lkk;
    for (let i = k + 1; i < n; i++) {
      let sum = A[i * n + k];
      for (let j = 0; j < k; j++) sum -= A[i * n + j] * A[k * n + j];
      A[i * n + k] = sum / lkk;
    }
  }
  return null;
}

export function cholSolve(L: Float64Array, b: Float64Array, n: number) {
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let j = 0; j < i; j++) s -= L[i * n + j] * y[j];
    y[i] = s / L[i * n + i];
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let j = i + 1; j < n; j++) s -= L[j * n + i] * x[j];
    x[i] = s / L[i * n + i];
  }
  return x;
}

