/** Nominal European sections. Areas and inertias are catalog values; plastic moduli use the plate model. Units converted to kN, m. */

export type ProfileKind = "I" | "box" | "pipe";

export type Section = {
  id: string;
  family: "IPE" | "HEB" | "SHS" | "CHS";
  kind: ProfileKind;
  /** Overall depth (m), along local z for I shapes. */
  h: number;
  /** Flange width or outer width (m). */
  b: number;
  tw: number;
  tf: number;
  A: number;
  /** Strong-axis inertia (m⁴) — bending about local y. */
  Iy: number;
  /** Weak-axis inertia (m⁴). */
  Iz: number;
  J: number;
  Cw: number;
  /** Plastic modulus, strong / weak (m³). */
  Zy: number;
  Zz: number;
  /** Elastic modulus (m³). */
  Sy: number;
  Sz: number;
  Aw: number;
  weight: number;
};

const CM2 = 1e-4;
const CM4 = 1e-8;

function torsionI(hMm: number, bMm: number, twMm: number, tfMm: number) {
  const h = hMm / 10;
  const b = bMm / 10;
  const tw = twMm / 10;
  const tf = tfMm / 10;
  const hw = Math.max(h - 2 * tf, 0);
  return ((2 * b * tf ** 3 + hw * tw ** 3) / 3) * CM4;
}

function warpingC(h: number, b: number, tf: number) {
  return ((tf * b ** 3) / 24) * (h - tf) ** 2;
}

function plasticI(h: number, b: number, tw: number, tf: number) {
  const hw = Math.max(h - 2 * tf, 0);
  const Zy = b * tf * (h - tf) + (tw * hw * hw) / 4;
  const Zz = (tf * b * b) / 2 + (hw * tw * tw) / 4;
  return { Zy, Zz, Aw: hw * tw };
}

function iShape(
  family: "IPE" | "HEB",
  hMm: number,
  bMm: number,
  twMm: number,
  tfMm: number,
  aCm2: number,
  iyCm4: number,
  izCm4: number,
): Section {
  const h = hMm / 1000;
  const b = bMm / 1000;
  const tw = twMm / 1000;
  const tf = tfMm / 1000;
  const A = aCm2 * CM2;
  const Iy = iyCm4 * CM4;
  const Iz = izCm4 * CM4;
  const { Zy, Zz, Aw } = plasticI(h, b, tw, tf);
  const Sy = Iy / (h / 2);
  const Sz = Iz / (b / 2);
  return {
    id: `${family}${hMm}`,
    family,
    kind: "I",
    h,
    b,
    tw,
    tf,
    A,
    Iy,
    Iz,
    J: torsionI(hMm, bMm, twMm, tfMm),
    Cw: warpingC(h, b, tf),
    Zy: Math.max(Zy, Sy),
    Zz: Math.max(Zz, Sz),
    Sy,
    Sz,
    Aw,
    weight: A * 7850,
  };
}

function shs(sizeMm: number, tMm: number): Section {
  const a = sizeMm / 1000;
  const t = tMm / 1000;
  const inner = Math.max(a - 2 * t, 0);
  const A = a * a - inner * inner;
  const I = (a ** 4 - inner ** 4) / 12;
  const mid = Math.max(a - t, t);
  const J = (4 * mid * mid * mid * mid * t) / (4 * mid) ;
  // Bredt: J = 4 Am² / ∮ ds/t , Am = (a-t)², perimeter loop = 4(a-t)
  const Am = (a - t) ** 2;
  const Jb = (4 * Am * Am) / ((4 * (a - t)) / t);
  const Z = (a ** 3 - inner ** 3) / 4;
  const S = I / (a / 2);
  return {
    id: `SHS${sizeMm}x${tMm}`,
    family: "SHS",
    kind: "box",
    h: a,
    b: a,
    tw: t,
    tf: t,
    A,
    Iy: I,
    Iz: I,
    J: Jb || J,
    Cw: 0,
    Zy: Math.max(Z, S),
    Zz: Math.max(Z, S),
    Sy: S,
    Sz: S,
    Aw: 2 * a * t,
    weight: A * 7850,
  };
}

function chs(dMm: number, tMm: number): Section {
  const D = dMm / 1000;
  const t = tMm / 1000;
  const d = Math.max(D - 2 * t, 0);
  const A = (Math.PI / 4) * (D * D - d * d);
  const I = (Math.PI / 64) * (D ** 4 - d ** 4);
  const Z = (D ** 3 - d ** 3) / 6;
  const S = I / (D / 2);
  return {
    id: `CHS${dMm}x${tMm}`,
    family: "CHS",
    kind: "pipe",
    h: D,
    b: D,
    tw: t,
    tf: t,
    A,
    Iy: I,
    Iz: I,
    J: 2 * I,
    Cw: 0,
    Zy: Math.max(Z, S),
    Zz: Math.max(Z, S),
    Sy: S,
    Sz: S,
    Aw: Math.PI * ((D + d) / 2) * t * 0.5,
    weight: A * 7850,
  };
}

const IPES: Array<[number, number, number, number, number, number, number]> = [
  [200, 100, 5.6, 8.5, 28.5, 1943, 142],
  [220, 110, 5.9, 9.2, 33.4, 2772, 205],
  [240, 120, 6.2, 9.8, 39.1, 3892, 284],
  [270, 135, 6.6, 10.2, 45.9, 5790, 420],
  [300, 150, 7.1, 10.7, 53.8, 8356, 604],
  [330, 160, 7.5, 11.5, 62.6, 11770, 788],
  [360, 170, 8.0, 12.7, 72.7, 16270, 1043],
  [400, 180, 8.6, 13.5, 84.5, 23130, 1318],
  [450, 190, 9.4, 14.6, 98.8, 33740, 1676],
  [500, 200, 10.2, 16.0, 116, 48200, 2142],
  [550, 210, 11.1, 17.2, 134, 67120, 2668],
  [600, 220, 12.0, 19.0, 156, 92080, 3387],
];

const HEBS: Array<[number, number, number, number, number, number, number]> = [
  [140, 140, 7, 12, 43, 1510, 550],
  [160, 160, 8, 13, 54.3, 2492, 889],
  [180, 180, 8.5, 14, 65.3, 3831, 1363],
  [200, 200, 9, 15, 78.1, 5696, 2003],
  [220, 220, 9.5, 16, 91, 8091, 2843],
  [240, 240, 10, 17, 106, 11260, 3923],
  [260, 260, 10, 17.5, 118.4, 14920, 5135],
  [280, 280, 10.5, 18, 131.4, 19270, 6595],
  [300, 300, 11, 19, 149, 25170, 8563],
  [320, 300, 11.5, 20.5, 161, 30820, 9239],
  [340, 300, 12, 21.5, 171, 36660, 9690],
  [360, 300, 12.5, 22.5, 181, 43190, 10140],
  [400, 300, 13.5, 24, 198, 57680, 10820],
  [450, 300, 14, 26, 218, 79890, 11720],
  [500, 300, 14.5, 28, 239, 107200, 12620],
];

export const SECTIONS: Section[] = [
  ...IPES.map((r) => iShape("IPE", r[0], r[1], r[2], r[3], r[4], r[5], r[6])),
  ...HEBS.map((r) => iShape("HEB", r[0], r[1], r[2], r[3], r[4], r[5], r[6])),
  ...[120, 150, 180, 200, 250, 300, 350, 400].flatMap((a) => {
    const ts = a <= 180 ? [6, 8, 10] : a <= 250 ? [8, 10, 12] : [10, 12, 16, 20];
    return ts.filter((t) => t * 2 < a).map((t) => shs(a, t));
  }),
  ...[
    [114, 6],
    [139, 6],
    [168, 8],
    [219, 8],
    [219, 12],
    [273, 10],
    [323, 12],
    [406, 12],
  ].map(([d, t]) => chs(d, t)),
];

const BY_ID = new Map(SECTIONS.map((s) => [s.id, s]));

export function sectionById(id: string): Section {
  return BY_ID.get(id) ?? SECTIONS.find((s) => s.family === "IPE")!;
}

export function sectionsOf(families: Section["family"][]): Section[] {
  const allow = new Set(families);
  return SECTIONS.filter((s) => allow.has(s.family)).sort((a, b) => a.weight - b.weight);
}

export const STEELS = [
  { id: "ST37", name: "ST37", fy: 240 },
  { id: "S275", name: "S275", fy: 275 },
  { id: "ST52", name: "ST52", fy: 360 },
  { id: "S355", name: "S355", fy: 355 },
] as const;
