import { sectionById } from "./sections.ts";
import {
  applyR,
  cholesky,
  cholSolve,
  endForces,
  expandU,
  freeMap,
  kExpOf,
  rayleighT,
  reduceF,
  scatterK,
  seismicLiveFactor,
  spectrumBN,
  toGlobalK,
  type Analysis,
  type Built,
  type EndForce,
  type FrameInput,
  type StoryInfo,
  type StructMember,
  type StructNode,
} from "./frame.ts";

function fail(
  input: FrameInput,
  built: Built,
  message: string,
  disp: Record<string, Float64Array>,
  seismic: Analysis["seismic"],
): Analysis {
  return {
    input,
    nodes: built.nodes,
    members: built.members,
    disp,
    memberResults: [],
    stories: [],
    seismic: { ...seismic, note: message },
    steelKg: built.members.reduce((s, m) => s + sectionById(m.sectionId).weight * m.L, 0),
    maxRatio: 0,
    maxDrift: 0,
    maxDisp: 0,
    verticalLoad: 0,
    verticalReaction: 0,
    stabilityOk: false,
    serviceOk: true,
    compactOk: true,
    standardsOk: false,
    codes: [],
    warnings: [message],
    unstable: message,
    combos: [],
  };
}

export type SeismicPack = {
  T: number;
  B: number;
  N: number;
  B1: number;
  C: number;
  Craw: number;
  Cmin: number;
  k: number;
  V: number;
  storyF: number[];
};

export type LatKey = "ExP" | "ExM" | "EyP" | "EyM";

export type SolvedFrame = {
  disp: Record<string, Float64Array>;
  stories: StoryInfo[];
  pack: SeismicPack;
  Ta: number;
  Tray: number;
  H: number;
  W: number;
  deadDown: number;
  verticalReaction: number;
  gravityForces: (D: number, L: number) => EndForce[];
  latForce: Record<LatKey, EndForce[]>;
  evMag: number;
  fL: number;
};

export function solveFrame(input: FrameInput, built: Built): SolvedFrame | { failed: Analysis } {
  const { nodes, members } = built;
  const ndofFull = nodes.length * 6;
  const map = freeMap(nodes, input.stories, input.diaphragm);
  const n = map.n;
  const K = new Float64Array(Math.max(n, 1) * Math.max(n, 1));
  const dofsOf = (m: StructMember) => {
    const d = new Array<number>(12);
    for (let e = 0; e < 2; e++) {
      const node = e === 0 ? m.i : m.j;
      for (let c = 0; c < 6; c++) d[e * 6 + c] = node * 6 + c;
    }
    return d;
  };
  const elementDof = members.map(dofsOf);
  if (n > 0) {
    members.forEach((m, e) => {
      scatterK(K, n, toGlobalK(built.kL[e], built.R[e]), elementDof[e], map.terms);
    });
  }
  const assembleQ = (qs: Float64Array[]) => {
    const F = new Float64Array(ndofFull);
    members.forEach((m, e) => {
      const g = applyR(built.R[e], qs[e], true);
      const loc = elementDof[e];
      for (let i = 0; i < 12; i++) F[loc[i]] += g[i];
    });
    return F;
  };
  const FD = assembleQ(built.qDead);
  const FL = assembleQ(built.qLive);

  const H = input.stories * input.storyH;
  const Ct = input.system === "dual" ? 0.05 : 0.08;
  const Ta = Ct * H ** 0.75;
  const levelW = new Array(input.stories + 1).fill(0);
  members.forEach((m) => {
    const sec = sectionById(m.sectionId);
    const massW = input.selfWeight ? (sec.weight * 9.81 * m.L) / 1000 : 0;
    if (m.group === "column") levelW[Math.max(nodes[m.j].story, 1)] += massW;
    else if (m.group !== "brace") levelW[nodes[m.i].story] += massW;
    else {
      levelW[Math.max(nodes[m.j].story, 1)] += massW * 0.5;
      levelW[Math.max(nodes[m.i].story, 1)] += massW * 0.5;
    }
  });
  const area = input.nx * input.bayX * input.ny * input.bayY;
  for (let k = 1; k <= input.stories; k++) levelW[k] += area * (input.qd + input.psi * input.ql);
  const levelP = levelW.map((w, k) => (k === 0 ? 0 : w + area * input.ql * (1 - input.psi)));
  let W = 0;
  for (let k = 1; k <= input.stories; k++) W += levelW[k];

  const nodesAt = (level: number) => nodes.filter((nd) => nd.story === level);
  const lateral = (dir: "x" | "y", eccSign: number, storyF: number[]) => {
    const F = new Float64Array(ndofFull);
    for (let k = 1; k <= input.stories; k++) {
      const group = nodesAt(k);
      if (!group.length || storyF[k] === 0) continue;
      const cx = group.reduce((s, nd) => s + nd.x, 0) / group.length;
      const cy = group.reduce((s, nd) => s + nd.y, 0) / group.length;
      const perp = dir === "x" ? input.ny * input.bayY : input.nx * input.bayX;
      const Mt = eccSign * 0.05 * perp * storyF[k];
      let ip = 0;
      for (const nd of group) {
        const arm = dir === "x" ? nd.y - cy : nd.x - cx;
        ip += arm * arm;
      }
      const share = storyF[k] / group.length;
      for (const nd of group) {
        const arm = dir === "x" ? nd.y - cy : nd.x - cx;
        const extra = ip > 1e-8 ? (Mt * arm) / ip : 0;
        if (dir === "x") F[nd.id * 6] += share + extra;
        else F[nd.id * 6 + 1] += share + extra;
      }
    }
    return F;
  };

  const seismicPack = (T: number) => {
    const spec = spectrumBN(T, input.soil, input.A);
    const Craw = input.seismicMode === "2800" ? (input.A * spec.B * input.Iimp) / input.R : input.C;
    const Cmin = 0.12 * input.A * input.Iimp;
    const C = input.seismicMode === "2800" ? Math.max(Craw, Cmin) : input.C;
    const k = kExpOf(T);
    let sumWh = 0;
    for (let s = 1; s <= input.stories; s++) sumWh += levelW[s] * (s * input.storyH) ** k;
    const storyF = new Array(input.stories + 1).fill(0);
    const V = C * W;
    for (let s = 1; s <= input.stories; s++) storyF[s] = sumWh > 0 ? (V * levelW[s] * (s * input.storyH) ** k) / sumWh : 0;
    return { T, B: spec.B, N: spec.N, B1: spec.B1, C, Craw, Cmin, k, V, storyF };
  };

  const blankDisp = () => ({
    D: new Float64Array(ndofFull),
    L: new Float64Array(ndofFull),
    ExP: new Float64Array(ndofFull),
    ExM: new Float64Array(ndofFull),
    EyP: new Float64Array(ndofFull),
    EyM: new Float64Array(ndofFull),
  });

  const seed = seismicPack(Ta);
  const meta = (note: string): Analysis["seismic"] => ({
    H,
    T: seed.T,
    Ta,
    Tray: 0,
    B: seed.B,
    N: seed.N,
    C: seed.C,
    k: seed.k,
    W,
    V: seed.V,
    note,
  });

  if (n === 0) return { failed: fail(input, built, "مدل درجه آزادی آزادی ندارد.", blankDisp(), meta("")) };

  let deadDown = 0;
  for (let i = 2; i < ndofFull; i += 6) deadDown -= FD[i];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = 0.5 * (K[i * n + j] + K[j * n + i]);
      K[i * n + j] = s;
      K[j * n + i] = s;
    }
  }
  const singular = cholesky(K, n);
  if (singular) return { failed: fail(input, built, singular, blankDisp(), meta("")) };

  const solve = (force: Float64Array) => expandU(map.terms, cholSolve(K, reduceF(map.terms, force, n), n));
  const disp = blankDisp();
  disp.D = solve(FD);
  disp.L = solve(FL);

  let pack = seed;
  const solveLateral = () => {
    disp.ExP = solve(lateral("x", 1, pack.storyF));
    disp.ExM = solve(lateral("x", -1, pack.storyF));
    disp.EyP = solve(lateral("y", 1, pack.storyF));
    disp.EyM = solve(lateral("y", -1, pack.storyF));
  };
  solveLateral();
  if (input.seismicMode === "2800") {
    for (let it = 0; it < 3; it++) {
      const Tx = rayleighT(nodes, input.stories, levelW, disp.ExP, 0, pack.storyF);
      const Ty = rayleighT(nodes, input.stories, levelW, disp.EyP, 1, pack.storyF);
      const TrayNow = Math.max(Tx, Ty);
      const Tnext = TrayNow > 0.05 ? Math.min(TrayNow, 1.25 * Ta) : Ta;
      if (Math.abs(Tnext - pack.T) <= Math.max(0.02, 0.03 * pack.T)) break;
      pack = seismicPack(Tnext);
      solveLateral();
    }
  }
  const Tray = Math.max(
    rayleighT(nodes, input.stories, levelW, disp.ExP, 0, pack.storyF),
    rayleighT(nodes, input.stories, levelW, disp.EyP, 1, pack.storyF),
  );

  const driftOf = (level: number, field: number, src: Float64Array) => {
    const up = nodesAt(level);
    const dn = nodesAt(level - 1);
    if (!up.length || !dn.length) return 0;
    const avg = (arr: StructNode[]) => arr.reduce((s, nd) => s + src[nd.id * 6 + field], 0) / arr.length;
    return avg(up) - avg(dn);
  };

  const stories: StoryInfo[] = [];
  const limitRatio = input.stories <= 5 ? 0.025 : 0.02;
  const thetaMax = Math.min(0.25, 0.5 / Math.max(input.Cd, 1));
  const b2of = (theta: number) => {
    if (!input.pdelta || theta <= 0.1) return 1;
    const capped = Math.min(theta, 0.45);
    return Math.min(2.5, 1 / (1 - capped));
  };
  for (let k = 1; k <= input.stories; k++) {
    const h = input.storyH;
    const driftEx = Math.max(Math.abs(driftOf(k, 0, disp.ExP)), Math.abs(driftOf(k, 0, disp.ExM)));
    const driftEy = Math.max(Math.abs(driftOf(k, 1, disp.EyP)), Math.abs(driftOf(k, 1, disp.EyM)));
    const P = levelP.slice(k).reduce((s, v) => s + v, 0);
    const Vs = pack.storyF.slice(k).reduce((s, v) => s + v, 0);
    const thetaX = Vs > 1e-6 ? (P * driftEx) / (Vs * h) : 0;
    const thetaY = Vs > 1e-6 ? (P * driftEy) / (Vs * h) : 0;
    const B2x = b2of(thetaX);
    const B2y = b2of(thetaY);
    const driftRealX = input.Cd * driftEx * B2x;
    const driftRealY = input.Cd * driftEy * B2y;
    const limit = limitRatio * h;
    stories.push({
      level: k,
      z: k * h,
      h,
      W: levelW[k],
      Fx: pack.storyF[k],
      Fy: pack.storyF[k],
      driftEx,
      driftEy,
      driftRealX,
      driftRealY,
      limit,
      thetaX,
      thetaY,
      thetaMax,
      B2x,
      B2y,
      okX: driftRealX <= limit + 1e-9,
      okY: driftRealY <= limit + 1e-9,
      thetaOkX: thetaX <= thetaMax + 1e-9,
      thetaOkY: thetaY <= thetaMax + 1e-9,
    });
  }

  let verticalReaction = 0;
  members.forEach((m, e) => {
    const baseI = nodes[m.i].base;
    const baseJ = nodes[m.j].base;
    if (!baseI && !baseJ) return;
    const fr = endForces(m, built.kL[e], built.R[e], built.qDead[e], built.qLive[e], disp.D, { D: 1, L: 0 });
    const fg = applyR(built.R[e], fr.f, true);
    if (baseI) verticalReaction += fg[2];
    if (baseJ) verticalReaction += fg[8];
  });

  const mixDisp = (D: number, L: number) => {
    const out = new Float64Array(ndofFull);
    for (let i = 0; i < ndofFull; i++) out[i] = D * disp.D[i] + L * disp.L[i];
    return out;
  };
  const gravCache = new Map<string, EndForce[]>();
  const gravityForces = (D: number, L: number) => {
    const key = `${D}_${L}`;
    const hit = gravCache.get(key);
    if (hit) return hit;
    const d = mixDisp(D, L);
    const list = members.map((m, e) => endForces(m, built.kL[e], built.R[e], built.qDead[e], built.qLive[e], d, { D, L }));
    gravCache.set(key, list);
    return list;
  };
  const latKeys = ["ExP", "ExM", "EyP", "EyM"] as const;
  const latForce: Record<(typeof latKeys)[number], EndForce[]> = {
    ExP: [],
    ExM: [],
    EyP: [],
    EyM: [],
  };
  for (const key of latKeys) {
    latForce[key] = members.map((m, e) =>
      endForces(m, built.kL[e], built.R[e], built.qDead[e], built.qLive[e], disp[key], { D: 0, L: 0 }),
    );
  }

  const evMag = input.seismicMode === "2800" && input.A + 1e-9 >= 0.35 ? 0.6 * input.A * input.Iimp : 0;
  const fL = seismicLiveFactor(input.ql);
  return { disp, stories, pack, Ta, Tray, H, W, deadDown, verticalReaction, gravityForces, latForce, evMag, fL };
}
