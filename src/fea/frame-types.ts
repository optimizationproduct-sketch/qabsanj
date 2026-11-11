import type { Section } from "./sections.ts";


export type SystemType = "moment" | "dual";
export type DeckType = "two-way" | "x-beams" | "y-beams";
export type SeismicMode = "2800" | "coeff";
export type SoilType = "I" | "II" | "III" | "IV";
export type StrongAxis = "X" | "Y";

export type FrameInput = {
  nx: number;
  ny: number;
  stories: number;
  bayX: number;
  bayY: number;
  storyH: number;
  columnSection: string;
  beamXSection: string;
  beamYSection: string;
  braceSection: string;
  system: SystemType;
  strongAlong: StrongAxis;
  deck: DeckType;
  qd: number;
  ql: number;
  psi: number;
  selfWeight: boolean;
  seismicMode: SeismicMode;
  C: number;
  A: number;
  Iimp: number;
  R: number;
  Cd: number;
  soil: SoilType;
  fy: number;
  Kcol: number;
  pdelta: boolean;
  /** Rigid floor diaphragm (concrete deck). */
  diaphragm: boolean;
  /** Slab braces the top flange of beams against lateral-torsional buckling. */
  deckBrace: boolean;
};

export const DEFAULT_INPUT: FrameInput = {
  nx: 3,
  ny: 2,
  stories: 4,
  bayX: 6,
  bayY: 5,
  storyH: 3.2,
  columnSection: "HEB240",
  beamXSection: "IPE330",
  beamYSection: "IPE300",
  braceSection: "CHS168x8",
  system: "moment",
  strongAlong: "X",
  deck: "two-way",
  qd: 5.5,
  ql: 2,
  psi: 0.2,
  selfWeight: true,
  seismicMode: "2800",
  C: 0.12,
  A: 0.3,
  Iimp: 1,
  R: 5,
  Cd: 4,
  soil: "II",
  fy: 240,
  Kcol: 1.2,
  pdelta: true,
  diaphragm: true,
  deckBrace: true,
};

export type StructNode = {
  id: number;
  x: number;
  y: number;
  z: number;
  story: number;
  ix: number;
  iy: number;
  base: boolean;
};

export type MemberGroup = "column" | "beamX" | "beamY" | "brace";

export type StructMember = {
  id: number;
  i: number;
  j: number;
  group: MemberGroup;
  sectionId: string;
  L: number;
  ex: V3;
  ey: V3;
  ez: V3;
};

export type ComboForce = {
  id: string;
  name: string;
  Pu: number;
  Tu: number;
  Mstrong: number;
  Mweak: number;
  V: number;
  ratio: number;
};

export type CheckRow = {
  label: string;
  ratio: number;
};

export type MemberResult = {
  id: number;
  group: MemberGroup;
  sectionId: string;
  L: number;
  ratio: number;
  governing: string;
  equation: string;
  combo: string;
  Pu: number;
  Tu: number;
  Mstrong: number;
  Mweak: number;
  V: number;
  phiPn: number;
  phiTn: number;
  phiVn: number;
  phiMnS: number;
  phiMnW: number;
  MnS: number;
  MnW: number;
  klr: number;
  cb: number;
  b1: number;
  lb: number;
  slenderQ: number;
  story: number;
  combos: ComboForce[];
  checks: CheckRow[];
};

export type CodeCheck = {
  id: string;
  clause: string;
  title: string;
  status: "pass" | "fail" | "info";
  detail: string;
};

export type StoryInfo = {
  level: number;
  z: number;
  h: number;
  W: number;
  Fx: number;
  Fy: number;
  driftEx: number;
  driftEy: number;
  driftRealX: number;
  driftRealY: number;
  limit: number;
  thetaX: number;
  thetaY: number;
  thetaMax: number;
  B2x: number;
  B2y: number;
  okX: boolean;
  okY: boolean;
  thetaOkX: boolean;
  thetaOkY: boolean;
};

export type Analysis = {
  input: FrameInput;
  nodes: StructNode[];
  members: StructMember[];
  disp: Record<string, Float64Array>;
  memberResults: MemberResult[];
  stories: StoryInfo[];
  seismic: {
    H: number;
    /** Period used for base shear. */
    T: number;
    Ta: number;
    Tray: number;
    B: number;
    N: number;
    C: number;
    k: number;
    W: number;
    V: number;
    note: string;
  };
  steelKg: number;
  maxRatio: number;
  maxDrift: number;
  maxDisp: number;
  verticalLoad: number;
  verticalReaction: number;
  stabilityOk: boolean;
  serviceOk: boolean;
  compactOk: boolean;
  standardsOk: boolean;
  codes: CodeCheck[];
  warnings: string[];
  unstable: string | null;
  combos: { id: string; name: string }[];
};

export const E = 2.0e8;
export const G = E / 2.6;
export const RHO_G = 77.0085;

export type V3 = [number, number, number];

function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(a: V3) {
  return Math.hypot(a[0], a[1], a[2]);
}
function unit(a: V3): V3 {
  const n = norm(a) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
}
export function dot(a: V3, b: V3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function orient(pi: StructNode, pj: StructNode, group: MemberGroup, strong: StrongAxis) {
  const ex = unit([pj.x - pi.x, pj.y - pi.y, pj.z - pi.z]);
  const vertical = Math.abs(ex[2]) > 0.85;
  let ey: V3;
  let ez: V3;
  if (!vertical) {
    ey = unit(cross([0, 0, 1], ex));
    ez = unit(cross(ex, ey));
  } else if (strong === "X") {
    ey = [0, -1, 0];
    ez = unit(cross(ex, ey));
  } else {
    ey = [1, 0, 0];
    ez = unit(cross(ex, ey));
  }
  return { ex, ey, ez, L: Math.hypot(pj.x - pi.x, pj.y - pi.y, pj.z - pi.z) };
}

