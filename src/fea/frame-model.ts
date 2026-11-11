import { sectionById } from "./sections.ts";
import { E, RHO_G, dot, orient, type DeckType, type FrameInput, type MemberGroup, type SoilType, type StrongAxis, type StructMember, type StructNode, type V3 } from "./frame-types.ts";
import { equiv, localK } from "./frame-stiff.ts";

export function hazardHigh(A: number) {
  return A + 1e-9 >= 0.3;
}

function soilParams(soil: SoilType, high: boolean) {
  if (soil === "I") return { T0: 0.1, Ts: 0.4, S: 1.5, S0: 1 };
  if (soil === "III") return { T0: 0.15, Ts: 0.7, S: 1.75, S0: 1.1 };
  if (soil === "IV") return high ? { T0: 0.15, Ts: 1, S: 1.75, S0: 1.1 } : { T0: 0.15, Ts: 1, S: 2.25, S0: 1.3 };
  return { T0: 0.1, Ts: 0.5, S: 1.5, S0: 1 };
}

/** B = B1·N، جدول ۲-۲ و بند ۲-۵ ویرایش چهارم. A ستون خطر جدول را انتخاب می‌کند. */
export function spectrumBN(T: number, soil: SoilType, A = 0.3) {
  const high = hazardHigh(A);
  const { T0, Ts, S, S0 } = soilParams(soil, high);
  const Tp = Math.max(T, 0);
  let B1: number;
  if (Tp <= T0) B1 = S0 + (S - S0 + 1) * (Tp / Math.max(T0, 1e-6));
  else if (Tp <= Ts) B1 = S + 1;
  else B1 = (S + 1) * (Ts / Tp);
  let N = 1;
  if (Tp > Ts) {
    const cap = high ? 1.7 : 1.4;
    const coef = high ? 0.7 : 0.4;
    N = Tp >= 4 ? cap : (coef / (4 - Ts)) * (Tp - Ts) + 1;
  }
  return { B1, N, B: B1 * N };
}

export function reflectionB(T: number, soil: SoilType, A = 0.3) {
  return spectrumBN(T, soil, A).B;
}

export function seismicLiveFactor(ql: number) {
  return ql > 5 + 1e-9 ? 1 : 0.5;
}

function bayLineLoad(Lx: number, Ly: number, q: number, deck: DeckType) {
  if (q === 0) return { wx: 0, wy: 0 };
  if (deck === "x-beams") return { wx: (q * Ly) / 2, wy: 0 };
  if (deck === "y-beams") return { wx: 0, wy: (q * Lx) / 2 };
  const Ls = Math.min(Lx, Ly);
  const Ll = Math.max(Lx, Ly);
  const wShort = (q * Ls) / 4;
  const wLong = Ll > 0 ? (q * (Ls / 2) * (Ll - Ls / 2)) / Ll : 0;
  return Lx <= Ly ? { wx: wShort, wy: wLong } : { wx: wLong, wy: wShort };
}

export type Built = {
  nodes: StructNode[];
  members: StructMember[];
  kL: Float64Array[];
  R: Float64Array[];
  qDead: Float64Array[];
  qLive: Float64Array[];
  wLine: number[];
};

export function clampInput(raw: FrameInput): FrameInput {
  const n = (v: number, a: number, b: number) => Math.min(b, Math.max(a, Math.round(v)));
  const p = (v: number, a: number, b: number) => Math.min(b, Math.max(a, Number.isFinite(v) ? v : a));
  return {
    ...raw,
    nx: n(raw.nx, 1, 4),
    ny: n(raw.ny, 1, 4),
    stories: n(raw.stories, 1, 6),
    bayX: p(raw.bayX, 2, 12),
    bayY: p(raw.bayY, 2, 12),
    storyH: p(raw.storyH, 2.4, 6),
    qd: p(raw.qd, 0, 20),
    ql: p(raw.ql, 0, 15),
    psi: p(raw.psi, 0, 1),
    C: p(raw.C, 0, 1.5),
    A: p(raw.A, 0.05, 0.5),
    Iimp: p(raw.Iimp, 0.8, 1.4),
    R: p(raw.R, 1, 12),
    Cd: p(raw.Cd, 1, 8),
    fy: p(raw.fy, 200, 460),
    Kcol: p(raw.Kcol, 0.5, 2.5),
  };
}

export function build(input: FrameInput): Built {
  const { nx, ny, stories, bayX, bayY, storyH, strongAlong, deck, system } = input;
  const nodes: StructNode[] = [];
  const idOf = (i: number, j: number, k: number) => k * (nx + 1) * (ny + 1) + j * (nx + 1) + i;
  for (let k = 0; k <= stories; k++) {
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        nodes.push({
          id: idOf(i, j, k),
          x: i * bayX,
          y: j * bayY,
          z: k * storyH,
          story: k,
          ix: i,
          iy: j,
          base: k === 0,
        });
      }
    }
  }
  const members: StructMember[] = [];
  const add = (i: number, j: number, group: MemberGroup, sectionId: string) => {
    const o = orient(nodes[i], nodes[j], group, strongAlong);
    if (o.L < 1e-6) return;
    members.push({
      id: members.length,
      i,
      j,
      group,
      sectionId,
      L: o.L,
      ex: o.ex,
      ey: o.ey,
      ez: o.ez,
    });
  };
  for (let k = 0; k < stories; k++) {
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) add(idOf(i, j, k), idOf(i, j, k + 1), "column", input.columnSection);
    }
  }
  for (let k = 1; k <= stories; k++) {
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i < nx; i++) add(idOf(i, j, k), idOf(i + 1, j, k), "beamX", input.beamXSection);
    }
    for (let i = 0; i <= nx; i++) {
      for (let j = 0; j < ny; j++) add(idOf(i, j, k), idOf(i, j + 1, k), "beamY", input.beamYSection);
    }
  }
  if (system === "dual") {
    const bayI = Math.floor((nx - 1) / 2);
    const bayJ = Math.floor((ny - 1) / 2);
    for (let k = 0; k < stories; k++) {
      for (const j of [0, ny]) {
        add(idOf(bayI, j, k), idOf(bayI + 1, j, k + 1), "brace", input.braceSection);
        add(idOf(bayI + 1, j, k), idOf(bayI, j, k + 1), "brace", input.braceSection);
      }
      for (const i of [0, nx]) {
        add(idOf(i, bayJ, k), idOf(i, bayJ + 1, k + 1), "brace", input.braceSection);
        add(idOf(i, bayJ + 1, k), idOf(i, bayJ, k + 1), "brace", input.braceSection);
      }
    }
  }

  const lineW = new Map<number, { dead: number; live: number }>();
  const touch = (a: number, b: number) => {
    const key = a < b ? a * 100000 + b : b * 100000 + a;
    return key;
  };
  const beamKey = new Map<number, number>();
  members.forEach((m, idx) => {
    if (m.group === "beamX" || m.group === "beamY") beamKey.set(touch(m.i, m.j), idx);
  });
  for (let k = 1; k <= stories; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const south = beamKey.get(touch(idOf(i, j, k), idOf(i + 1, j, k)));
        const north = beamKey.get(touch(idOf(i, j + 1, k), idOf(i + 1, j + 1, k)));
        const west = beamKey.get(touch(idOf(i, j, k), idOf(i, j + 1, k)));
        const east = beamKey.get(touch(idOf(i + 1, j, k), idOf(i + 1, j + 1, k)));
        for (const [q, field] of [
          [input.qd, "dead"],
          [input.ql, "live"],
        ] as const) {
          const { wx, wy } = bayLineLoad(bayX, bayY, q, deck);
          for (const [id, w] of [
            [south, wx],
            [north, wx],
            [west, wy],
            [east, wy],
          ] as const) {
            if (id === undefined || !w) continue;
            const cur = lineW.get(id) ?? { dead: 0, live: 0 };
            cur[field] += w;
            lineW.set(id, cur);
          }
        }
      }
    }
  }

  const kL: Float64Array[] = [];
  const Rm: Float64Array[] = [];
  const qDead: Float64Array[] = [];
  const qLive: Float64Array[] = [];
  const wLine: number[] = [];
  for (const m of members) {
    const sec = sectionById(m.sectionId);
    const truss = m.group === "brace";
    kL.push(localK(sec, m.L, truss));
    const R = new Float64Array(9);
    R.set([...m.ex, ...m.ey, ...m.ez]);
    Rm.push(R);
    const sw = input.selfWeight ? sec.A * RHO_G : 0;
    wLine.push(sw);
    const g: V3 = [0, 0, -(sw)];
    const floors = lineW.get(m.id) ?? { dead: 0, live: 0 };
    const qzDead = dot(m.ez, g) - floors.dead;
    const qzLive = -floors.live;
    const qx = dot(m.ex, g);
    const qy = dot(m.ey, g);
    qDead.push(equiv(qx, qy, qzDead, m.L, truss));
    qLive.push(equiv(0, 0, qzLive, m.L, truss));
  }
  return { nodes, members, kL, R: Rm, qDead, qLive, wLine };
}

