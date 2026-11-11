import { applyR, mulK } from "./frame-stiff.ts";
import type { StructMember, StructNode } from "./frame-types.ts";

export type Combo = { id: string; name: string; D: number; L: number; Ex: number; Ey: number; eccX: number; eccY: number; Ev: number };

export function buildCombos(fL: number): Combo[] {
  const liveLabel = fL >= 0.99 ? "L" : "۰٫۵L";
  const combos: Combo[] = [
    { id: "D14", name: "۱٫۴D", D: 1.4, L: 0, Ex: 0, Ey: 0, eccX: 0, eccY: 0, Ev: 0 },
    { id: "DL", name: "۱٫۲D+۱٫۶L", D: 1.2, L: 1.6, Ex: 0, Ey: 0, eccX: 0, eccY: 0, Ev: 0 },
  ];
  const arms: { tag: string; Ex: number; Ey: number; label: string }[] = [
    { tag: "X", Ex: 1, Ey: 0.3, label: "Ex+۰٫۳Ey" },
    { tag: "Y", Ex: 0.3, Ey: 1, label: "Ey+۰٫۳Ex" },
  ];
  for (const arm of arms) {
    for (const sx of [1, -1]) {
      for (const sy of [1, -1]) {
        const ecc = `${sx > 0 ? "+" : "−"}${sy > 0 ? "+" : "−"}`;
        combos.push({
          id: `${arm.tag}${sx > 0 ? "p" : "m"}${sy > 0 ? "p" : "m"}`,
          name: `۱٫۲D+${liveLabel}+${arm.label} (${ecc})`,
          D: 1.2,
          L: fL,
          Ex: arm.Ex,
          Ey: arm.Ey,
          eccX: sx,
          eccY: sy,
          Ev: 0,
        });
        combos.push({
          id: `U${arm.tag}${sx > 0 ? "p" : "m"}${sy > 0 ? "p" : "m"}`,
          name: `۰٫۹D+${arm.label} (${ecc})`,
          D: 0.9,
          L: 0,
          Ex: arm.Ex,
          Ey: arm.Ey,
          eccX: sx,
          eccY: sy,
          Ev: 0,
        });
      }
    }
  }
  return combos;
}

export function withVertical(ev: number, base: Combo[]): Combo[] {
  if (ev <= 0) return base;
  const out: Combo[] = [];
  for (const c of base) {
    if (c.Ex === 0 && c.Ey === 0) out.push(c);
    else {
      out.push({ ...c, id: `${c.id}p`, name: `${c.name} +Ev`, Ev: ev });
      out.push({ ...c, id: `${c.id}n`, name: `${c.name} −Ev`, Ev: -ev });
    }
  }
  return out;
}

export type EndForce = { f: Float64Array; qx: number; qy: number; qz: number };

export function endForces(
  m: StructMember,
  kL: Float64Array,
  R: Float64Array,
  qD: Float64Array,
  qL: Float64Array,
  dFull: Float64Array,
  factors: { D: number; L: number },
): EndForce {
  const dg = new Float64Array(12);
  const ends = [m.i, m.j];
  for (let e = 0; e < 2; e++) {
    const base = ends[e] * 6;
    for (let c = 0; c < 6; c++) dg[e * 6 + c] = dFull[base + c];
  }
  const dL = applyR(R, dg, false);
  const q = new Float64Array(12);
  for (let i = 0; i < 12; i++) q[i] = factors.D * qD[i] + factors.L * qL[i];
  const f = mulK(kL, dL);
  for (let i = 0; i < 12; i++) f[i] -= q[i];
  const qx = factors.D * ((qD[0] + qD[6]) / m.L) + factors.L * ((qL[0] + qL[6]) / m.L);
  const qy = factors.D * ((qD[1] + qD[7]) / m.L) + factors.L * ((qL[1] + qL[7]) / m.L);
  const qz = factors.D * ((qD[2] + qD[8]) / m.L) + factors.L * ((qL[2] + qL[8]) / m.L);
  return { f, qx, qy, qz };
}

export function atX(fr: EndForce, x: number, L: number) {
  const f = fr.f;
  const N = f[0] * (1 - x / L) + -f[6] * (x / L);
  const My = -f[4] - x * f[2] - (fr.qz * x * x) / 2;
  const Mz = -f[5] + x * f[1] + (fr.qy * x * x) / 2;
  const Vy = f[1] + fr.qy * x;
  const Vz = f[2] + fr.qz * x;
  return { N, My, Mz, Vy, Vz };
}

export type Term = { q: number; c: number };
export type DofMap = { terms: Term[][]; n: number };

export function freeMap(nodes: StructNode[], stories: number, diaphragm: boolean): DofMap {
  const terms: Term[][] = Array.from({ length: nodes.length * 6 }, () => []);
  if (!diaphragm) {
    let n = 0;
    nodes.forEach((node, i) => {
      if (node.base) return;
      for (let c = 0; c < 6; c++) terms[i * 6 + c] = [{ q: n++, c: 1 }];
    });
    return { terms, n };
  }
  let n = 0;
  const master = new Map<number, { ux: number; uy: number; rz: number; xm: number; ym: number }>();
  for (let k = 1; k <= stories; k++) {
    const group = nodes.filter((nd) => nd.story === k);
    if (!group.length) continue;
    const xm = group.reduce((s, nd) => s + nd.x, 0) / group.length;
    const ym = group.reduce((s, nd) => s + nd.y, 0) / group.length;
    master.set(k, { ux: n++, uy: n++, rz: n++, xm, ym });
  }
  for (const nd of nodes) {
    if (nd.base) continue;
    const b = nd.id * 6;
    const m = master.get(nd.story);
    if (!m) continue;
    terms[b + 2] = [{ q: n++, c: 1 }];
    terms[b + 3] = [{ q: n++, c: 1 }];
    terms[b + 4] = [{ q: n++, c: 1 }];
    terms[b + 0] = [
      { q: m.ux, c: 1 },
      { q: m.rz, c: -(nd.y - m.ym) },
    ];
    terms[b + 1] = [
      { q: m.uy, c: 1 },
      { q: m.rz, c: nd.x - m.xm },
    ];
    terms[b + 5] = [{ q: m.rz, c: 1 }];
  }
  return { terms, n };
}

export function scatterK(K: Float64Array, n: number, Kg: Float64Array, loc: number[], terms: Term[][]) {
  for (let i = 0; i < 12; i++) {
    const ti = terms[loc[i]];
    if (!ti?.length) continue;
    for (let j = 0; j < 12; j++) {
      const tj = terms[loc[j]];
      const kij = Kg[i * 12 + j];
      if (!tj?.length || kij === 0) continue;
      for (const a of ti) {
        for (const b of tj) K[a.q * n + b.q] += a.c * b.c * kij;
      }
    }
  }
}

export function reduceF(terms: Term[][], full: Float64Array, n: number) {
  const rhs = new Float64Array(n);
  for (let d = 0; d < full.length; d++) {
    const f = full[d];
    if (f === 0) continue;
    for (const t of terms[d]) rhs[t.q] += t.c * f;
  }
  return rhs;
}

export function expandU(terms: Term[][], q: Float64Array) {
  const full = new Float64Array(terms.length);
  for (let d = 0; d < terms.length; d++) {
    let s = 0;
    for (const t of terms[d]) s += t.c * q[t.q];
    full[d] = s;
  }
  return full;
}

export function kExpOf(T: number) {
  if (T <= 0.5) return 1;
  if (T >= 2.5) return 2;
  return 1 + (T - 0.5) / 2;
}

export function rayleighT(nodes: StructNode[], stories: number, levelW: number[], disp: Float64Array, dir: 0 | 1, storyF: number[]) {
  let num = 0;
  let den = 0;
  const g = 9.80665;
  for (let k = 1; k <= stories; k++) {
    const group = nodes.filter((nd) => nd.story === k);
    if (!group.length || storyF[k] === 0) continue;
    const u = group.reduce((s, nd) => s + disp[nd.id * 6 + dir], 0) / group.length;
    num += levelW[k] * u * u;
    den += storyF[k] * u;
  }
  if (den <= 1e-8 || num <= 0) return 0;
  return (2 * Math.PI) * Math.sqrt(num / (g * den));
}
