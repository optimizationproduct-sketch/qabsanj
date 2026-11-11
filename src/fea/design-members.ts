import { sectionById } from "./sections.ts";
import { E, atX, buildCombos, withVertical, type ComboForce, type EndForce, type FrameInput, type MemberResult, type StoryInfo, type StructMember, type StructNode } from "./frame.ts";
import { b1Factor, cbFactor, cmFactor, interact, nominalStrong, nominalWeak } from "./steel.ts";
import type { LatKey } from "./solve-frame.ts";

export function designMembers(ctx: {
  input: FrameInput;
  members: StructMember[];
  nodes: StructNode[];
  stories: StoryInfo[];
  gravityForces: (D: number, L: number) => EndForce[];
  latForce: Record<LatKey, EndForce[]>;
  evMag: number;
  fL: number;
}): MemberResult[] {
  const { input, members, nodes, stories, gravityForces, latForce, evMag, fL } = ctx;
  const designCombos = withVertical(evMag, buildCombos(fL));
  const storyOf = (m: StructMember) => Math.max(nodes[m.i].story, nodes[m.j].story);
  const ST = 8;

  const memberResults: MemberResult[] = members.map((m, e) => {
    const sec = sectionById(m.sectionId);
    const story = storyOf(m);
    const st = stories[Math.max(0, story - 1)];
    const beam = m.group === "beamX" || m.group === "beamY";
    const Keff = m.group === "column" ? input.Kcol : 1;
    let best: MemberResult | null = null;
    const combos: ComboForce[] = [];
    for (const c of designCombos) {
      const gF = gravityForces(c.D + c.Ev, c.L)[e];
      const xF = latForce[c.eccX >= 0 ? "ExP" : "ExM"][e];
      const yF = latForce[c.eccY >= 0 ? "EyP" : "EyM"][e];
      const B2x = c.Ex !== 0 ? (st?.B2x ?? 1) : 1;
      const B2y = c.Ey !== 0 ? (st?.B2y ?? 1) : 1;
      const field = (x: number, b1s: number, b1w: number) => {
        const g = atX(gF, x, m.L);
        const lx = atX(xF, x, m.L);
        const ly = atX(yF, x, m.L);
        return {
          N: g.N + c.Ex * B2x * lx.N + c.Ey * B2y * ly.N,
          My: b1s * g.My + c.Ex * B2x * lx.My + c.Ey * B2y * ly.My,
          Mz: b1w * g.Mz + c.Ex * B2x * lx.Mz + c.Ey * B2y * ly.Mz,
          Vy: g.Vy + c.Ex * B2x * lx.Vy + c.Ey * B2y * ly.Vy,
          Vz: g.Vz + c.Ex * B2x * lx.Vz + c.Ey * B2y * ly.Vz,
        };
      };
      let pMax = 0;
      for (let s = 0; s <= ST; s++) pMax = Math.max(pMax, field((m.L * s) / ST, 1, 1).N);
      const g0 = atX(gF, 0, m.L);
      const gL = atX(gF, m.L, m.L);
      const b1s = b1Factor(cmFactor(g0.My, gL.My, beam), pMax, (Math.PI ** 2 * E * sec.Iy) / (m.L * m.L));
      const b1w = b1Factor(cmFactor(g0.Mz, gL.Mz, beam), pMax, (Math.PI ** 2 * E * sec.Iz) / (m.L * m.L));
      const samples = [0, 0.25, 0.5, 0.75, 1].map((t) => field(t * m.L, b1s, b1w).My);
      const cb = cbFactor(samples);
      let hog = 0;
      let run = 0;
      const nS = 16;
      for (let s = 0; s <= nS; s++) {
        if (field((m.L * s) / nS, b1s, b1w).My > 0) run += m.L / nS;
        else {
          hog = Math.max(hog, run);
          run = 0;
        }
      }
      hog = Math.max(hog, run);
      const lbTop = beam && input.deckBrace ? 0 : m.L;
      const lbBot = beam && input.deckBrace ? hog : m.L;
      const MnTop = nominalStrong(sec, input.fy, beam ? lbTop : m.L, cb);
      const MnBot = nominalStrong(sec, input.fy, beam ? lbBot : m.L, cb);
      const MnW = nominalWeak(sec, input.fy);
      let localBest: {
        ratio: number;
        governing: string;
        equation: string;
        Pu: number;
        Tu: number;
        Ms: number;
        Mw: number;
        V: number;
        phiPn: number;
        phiTn: number;
        phiVn: number;
        phiMnS: number;
        phiMnW: number;
        klr: number;
        Q: number;
        compR: number;
        tenR: number;
        flex: number;
        shr: number;
        lb: number;
        b1: number;
        sign: number;
      } | null = null;
      for (let s = 0; s <= ST; s++) {
        const p = field((m.L * s) / ST, b1s, b1w);
        const Pu = Math.max(p.N, 0);
        const Tu = Math.max(-p.N, 0);
        const phiMnS = 0.9 * (beam ? (p.My >= 0 ? MnBot : MnTop) : MnTop);
        const des = interact(sec, m.L, Keff, input.fy, Pu, Tu, Math.abs(p.My), Math.abs(p.Mz), Math.hypot(p.Vy, p.Vz), phiMnS, 0.9 * MnW);
        if (!localBest || des.ratio > localBest.ratio) {
          localBest = {
            ...des,
            Pu,
            Tu,
            Ms: Math.abs(p.My),
            Mw: Math.abs(p.Mz),
            V: Math.hypot(p.Vy, p.Vz),
            phiMnS,
            phiMnW: 0.9 * MnW,
            lb: beam ? (p.My >= 0 ? lbBot : lbTop) : m.L,
            b1: Math.max(b1s, b1w),
            sign: p.My,
          };
        }
      }
      const des = localBest!;
      let governing = des.governing;
      if (des.equation === "F2" && beam && input.deckBrace) {
        governing = des.sign >= 0 ? "خمش بال پایین، بدون مهار سقف (F2)" : "خمش بال بالا، مهار سقف (F2)";
      }
      combos.push({
        id: c.id,
        name: c.name,
        Pu: des.Pu,
        Tu: des.Tu,
        Mstrong: des.Ms,
        Mweak: des.Mw,
        V: des.V,
        ratio: des.ratio,
      });
      if (!best || des.ratio > best.ratio) {
        best = {
          id: m.id,
          group: m.group,
          sectionId: m.sectionId,
          L: m.L,
          ratio: des.ratio,
          governing,
          equation: des.equation,
          combo: c.name,
          Pu: des.Pu,
          Tu: des.Tu,
          Mstrong: des.Ms,
          Mweak: des.Mw,
          V: des.V,
          phiPn: des.phiPn,
          phiTn: des.phiTn,
          phiVn: des.phiVn,
          phiMnS: des.phiMnS,
          phiMnW: des.phiMnW,
          MnS: des.phiMnS / 0.9,
          MnW: MnW,
          klr: des.klr,
          cb,
          b1: des.b1,
          lb: des.lb,
          slenderQ: des.Q,
          story,
          combos,
          checks: [
            { label: "فشار / φcPn", ratio: des.compR },
            { label: "کشش / φtTn", ratio: des.tenR },
            { label: "جمع خمش دو محور", ratio: des.flex },
            { label: "برش / φvVn", ratio: des.shr },
          ],
        };
      }
    }
    best!.combos = combos;
    return best!;
  });
  return memberResults;
}
