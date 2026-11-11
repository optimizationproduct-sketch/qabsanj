import type { Section } from "./sections.ts";
import { E, type FrameInput, type MemberGroup } from "./frame.ts";

export function fyOf(fyMPa: number) {
  return fyMPa * 1000;
}

export function nominalWeak(sec: Section, fyMPa: number) {
  const fy = fyOf(fyMPa);
  const My = fy * sec.Sz;
  const Mp = fy * sec.Zz;
  let Mn = Math.min(Mp, 1.6 * My);
  if (sec.kind === "I") {
    const lam = sec.b / 2 / Math.max(sec.tf, 1e-9);
    const lamP = 0.38 * Math.sqrt(E / fy);
    const lamR = 1.0 * Math.sqrt(E / fy);
    if (lam > lamR) Mn = My;
    else if (lam > lamP) Mn = Mp - (Mp - 0.7 * My) * ((lam - lamP) / (lamR - lamP));
  }
  return Math.max(Mn, 1e-9);
}

export function nominalStrong(sec: Section, fyMPa: number, Lb: number, Cb: number) {
  const fy = fyOf(fyMPa);
  const Mp = fy * sec.Zy;
  const My = fy * sec.Sy;
  let Mn = Math.min(Mp, 1.6 * My);
  if (sec.kind === "I") {
    const lamF = sec.b / 2 / Math.max(sec.tf, 1e-9);
    const lamP = 0.38 * Math.sqrt(E / fy);
    const lamR = 1.0 * Math.sqrt(E / fy);
    if (lamF > lamR) Mn = My * (lamR / lamF);
    else if (lamF > lamP) Mn = Mp - (Mp - 0.7 * My) * ((lamF - lamP) / (lamR - lamP));
    const lamW = Math.max(sec.h - 2 * sec.tf, 0) / Math.max(sec.tw, 1e-9);
    if (lamW > 3.76 * Math.sqrt(E / fy)) Mn = Math.min(Mn, My);
    if (Lb > 1e-3) {
      const ry = Math.sqrt(sec.Iz / Math.max(sec.A, 1e-12));
      const rts = Math.max(sec.b / Math.sqrt(12), ry);
      const ho = Math.max(sec.h - sec.tf, sec.h * 0.85);
      const J = Math.max(sec.J, 1e-12);
      const Lp = 1.76 * ry * Math.sqrt(E / fy);
      const inside = (J * 1) / (sec.Sy * ho);
      const Lr =
        1.95 * rts * (E / (0.7 * fy)) * Math.sqrt(inside + Math.sqrt(inside * inside + 6.76 * (0.7 * fy / E) ** 2));
      const CbC = Math.min(3, Math.max(1, Cb));
      let Mltb = Mn;
      if (Lb <= Lp) Mltb = Mn;
      else if (Lb <= Lr) {
        Mltb = CbC * (Mp - (Mp - 0.7 * My) * ((Lb - Lp) / Math.max(Lr - Lp, 1e-6)));
        Mltb = Math.min(Mp, Math.max(Mltb, 0.7 * My * 0.5));
      } else {
        const FcrB =
          ((CbC * Math.PI ** 2 * E) / (Lb / rts) ** 2) * Math.sqrt(1 + 0.078 * inside * (Lb / rts) ** 2);
        Mltb = FcrB * sec.Sy;
      }
      Mn = Math.min(Mn, Math.max(Mltb, 1e-6));
    }
  } else if (sec.kind === "pipe") {
    const Dt = sec.h / Math.max(sec.tf, 1e-9);
    const compact = 0.07 * E / fy;
    if (Dt > compact) Mn = Math.min(Mn, (Math.min(1, (0.021 * E) / (fy * Dt) + 1)) * My);
  }
  return Math.min(Math.max(Mn, 1e-9), 1.6 * My);
}

function fcrQ1(fy: number, Fe: number) {
  const slend = Math.PI * Math.sqrt(E / Math.max(Fe, 1));
  const limit = 4.71 * Math.sqrt(E / fy);
  return slend <= limit ? 0.658 ** (fy / Fe) * fy : 0.877 * Fe;
}

function slenderQ(sec: Section, fy: number, Fe: number) {
  const Fcr1 = Math.max(fcrQ1(fy, Fe), 1);
  if (sec.kind === "I") {
    const lam = sec.b / 2 / Math.max(sec.tf, 1e-9);
    const lim1 = 0.56 * Math.sqrt(E / fy);
    let Qs = 1;
    if (lam > 1.03 * Math.sqrt(E / fy)) Qs = (0.69 * E) / (fy * lam * lam);
    else if (lam > lim1) Qs = 1.415 - 0.65 * lam * Math.sqrt(fy / E);
    Qs = Math.min(1, Math.max(0.25, Qs));
    const hw = Math.max(sec.h - 2 * sec.tf, 0);
    const lamW = hw / Math.max(sec.tw, 1e-9);
    const lamWr = 1.49 * Math.sqrt(E / fy);
    let Qa = 1;
    if (lamW > lamWr && hw > 0) {
      const root = Math.sqrt(E / Fcr1);
      const he = Math.min(hw, Math.max(0, 1.92 * sec.tw * root * (1 - (0.34 / lamW) * root)));
      Qa = Math.min(1, Math.max(0.3, (sec.A - (hw - he) * sec.tw) / sec.A));
    }
    return Math.min(1, Math.max(0.2, Qs * Qa));
  }
  if (sec.kind === "box") {
    const clear = Math.max(sec.h - 2 * sec.tf, sec.tf);
    const lam = clear / Math.max(sec.tf, 1e-9);
    const lamR = 1.4 * Math.sqrt(E / fy);
    if (lam <= lamR) return 1;
    const root = Math.sqrt(E / Fcr1);
    const be = Math.min(clear, Math.max(0, 1.92 * sec.tf * root * (1 - (0.34 / lam) * root)));
    const Aeff = sec.A - 4 * (clear - be) * sec.tf;
    return Math.min(1, Math.max(0.25, Aeff / sec.A));
  }
  const Dt = sec.h / Math.max(sec.tf, 1e-9);
  const lamR = (0.11 * E) / fy;
  if (Dt <= lamR) return 1;
  return Math.min(1, Math.max(0.25, (0.038 * E) / (fy * Dt) + 2 / 3));
}

function compressionCapacity(sec: Section, L: number, K: number, fyMPa: number) {
  const fy = fyOf(fyMPa);
  const rx = Math.sqrt(sec.Iy / Math.max(sec.A, 1e-12));
  const ry = Math.sqrt(sec.Iz / Math.max(sec.A, 1e-12));
  const slend = Math.max((K * L) / Math.max(rx, 1e-9), (K * L) / Math.max(ry, 1e-9));
  const Fe = (Math.PI ** 2 * E) / (slend * slend);
  const Q = slenderQ(sec, fy, Fe);
  const fyStar = Math.max(Q * fy, 1);
  const limit = 4.71 * Math.sqrt(E / fyStar);
  const Fcr = slend <= limit ? 0.658 ** (fyStar / Fe) * fyStar : 0.877 * Fe;
  return { phiPn: 0.9 * Fcr * sec.A, phiTn: 0.9 * fy * sec.A, klr: slend, Q };
}

function shearCapacity(sec: Section, fyMPa: number) {
  const fy = fyOf(fyMPa);
  if (sec.kind === "I") {
    const Aw = Math.max(sec.h * sec.tw, sec.Aw);
    const htw = Math.max(sec.h - 2 * sec.tf, sec.tw) / Math.max(sec.tw, 1e-9);
    const kv = 5.34;
    const phi = htw <= 2.24 * Math.sqrt(E / fy) ? 1 : 0.9;
    let Cv = 1;
    const lim = 1.1 * Math.sqrt((kv * E) / fy);
    if (htw > lim) {
      const lim2 = 1.37 * Math.sqrt((kv * E) / fy);
      Cv = htw <= lim2 ? lim / htw : (1.51 * kv * E) / (htw * htw * fy);
    }
    return phi * 0.6 * fy * Aw * Math.min(1, Math.max(Cv, 0.05));
  }
  if (sec.kind === "box") return 0.9 * 0.6 * fy * Math.max(sec.Aw, 2 * sec.h * sec.tf);
  const Dt = sec.h / Math.max(sec.tf, 1e-9);
  const Fcr = Math.min(0.6 * fy, (1.6 * E) / Dt ** 1.25);
  return 0.9 * Fcr * (sec.A / 2);
}

function hic(axial: number, flex: number) {
  if (axial <= 0 && flex <= 0) return 0;
  return axial >= 0.2 ? axial + (8 / 9) * flex : axial / 2 + flex;
}

export function interact(
  sec: Section,
  L: number,
  K: number,
  fyMPa: number,
  Pu: number,
  Tu: number,
  Ms: number,
  Mw: number,
  V: number,
  phiMnS: number,
  phiMnW: number,
) {
  const ax = compressionCapacity(sec, L, K, fyMPa);
  const phiVn = Math.max(shearCapacity(sec, fyMPa), 1e-9);
  const flex = Ms / Math.max(phiMnS, 1e-9) + Mw / Math.max(phiMnW, 1e-9);
  const compR = Pu / Math.max(ax.phiPn, 1e-9);
  const tenR = Tu / Math.max(ax.phiTn, 1e-9);
  const cH = hic(compR, flex);
  const tH = hic(tenR, flex);
  const shr = V / phiVn;
  let ratio = cH;
  let governing = compR >= 0.2 ? "اندرکنش فشار و خمش (H1-1a)" : "اندرکنش فشار و خمش (H1-1b)";
  let equation = compR >= 0.2 ? "H1-1a" : "H1-1b";
  if (tH > ratio) {
    ratio = tH;
    governing = tenR >= 0.2 ? "اندرکنش کشش و خمش (H1-1a)" : "اندرکنش کشش و خمش (H1-1b)";
    equation = tenR >= 0.2 ? "H1-1a" : "H1-1b";
  }
  if (shr > ratio) {
    ratio = shr;
    governing = "برش (G2)";
    equation = "G2";
  }
  if (compR < 0.02 && tenR < 0.02 && shr < ratio) {
    governing = "خمش تنها (F2)";
    equation = "F2";
  }
  return {
    ratio,
    governing,
    equation,
    phiPn: ax.phiPn,
    phiTn: ax.phiTn,
    phiVn,
    klr: ax.klr,
    Q: ax.Q,
    compR,
    tenR,
    flex,
    shr,
  };
}

export function cmFactor(M1: number, M2: number, transverse: boolean) {
  if (transverse) return 1;
  const a1 = Math.abs(M1);
  const a2 = Math.abs(M2);
  const big = Math.max(a1, a2);
  if (big < 1e-6) return 1;
  const same = M1 * M2 >= 0;
  const ratio = (same ? 1 : -1) * (Math.min(a1, a2) / big);
  return Math.max(0.2, 0.6 - 0.4 * ratio);
}

export function b1Factor(Cm: number, P: number, Pe: number) {
  if (!(P > 0) || !(Pe > 0)) return 1;
  const a = P / Pe;
  if (a >= 0.85) return Math.min(8, Math.max(1, Cm / 0.15));
  return Math.max(1, Cm / (1 - a));
}

export function cbFactor(samples: number[]) {
  const abs = samples.map((v) => Math.abs(v));
  const Mmax = Math.max(...abs, 0);
  if (Mmax < 1e-6) return 1;
  const MA = abs[1] ?? abs[0];
  const MB = abs[2] ?? abs[0];
  const MC = abs[3] ?? abs[0];
  const cb = (12.5 * Mmax) / (2.5 * Mmax + 3 * MA + 4 * MB + 3 * MC);
  return Math.min(3, Math.max(1, cb));
}

export function beamRelDeflection(L: number, qz: number, My0: number, MyL: number, I: number) {
  const wDown = -qz;
  const EI = E * Math.max(I, 1e-12);
  const d = (5 * wDown * L ** 4) / (384 * EI) - ((My0 + MyL) * L * L) / (16 * EI);
  return Math.max(0, d);
}

export function ductilityOf(input: FrameInput): "ویژه" | "متوسط" | "معمولی" {
  if (input.R >= 7) return "ویژه";
  if (input.R >= 4.5) return "متوسط";
  return "معمولی";
}

export function sectionSeismicOk(sec: Section, fyMPa: number, duct: "ویژه" | "متوسط" | "معمولی", Ca: number, group: MemberGroup) {
  if (duct === "معمولی") return true;
  const fy = fyOf(fyMPa);
  const s = Math.sqrt(E / fy);
  const hd = duct === "ویژه";
  if (sec.kind === "I") {
    const lamF = sec.b / 2 / Math.max(sec.tf, 1e-9);
    if (lamF > (hd ? 0.3 : 0.38) * s + 1e-8) return false;
    const lamW = Math.max(sec.h - 2 * sec.tf, 0) / Math.max(sec.tw, 1e-9);
    let limW: number;
    if (group === "column") {
      limW = hd
        ? Ca <= 0.125
          ? 2.45 * s
          : Math.max(1.49 * s, 0.77 * s * (2.93 - Ca))
        : Ca <= 0.125
          ? 3.76 * s
          : Math.max(1.49 * s, 1.12 * s * (2.33 - Ca));
    } else limW = (hd ? 2.45 : 3.76) * s;
    return lamW <= limW + 1e-8;
  }
  if (sec.kind === "pipe") {
    const Dt = sec.h / Math.max(sec.tf, 1e-9);
    return Dt <= (hd ? 0.038 : 0.07) * (E / fy) + 1e-8;
  }
  const bt = Math.max(sec.h - 2 * sec.tf, sec.tf) / Math.max(sec.tf, 1e-9);
  return bt <= (hd ? 0.55 : 0.64) * s + 1e-8;
}
