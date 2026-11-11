import { sectionById, sectionsOf, type Section } from "./sections.ts";
import {
  applyR,
  build,
  cholesky,
  cholSolve,
  clampInput,
  equiv,
  localK,
  mulK,
  toGlobalK,
  type Analysis,
  type FrameInput,
  type MemberGroup,
  type MemberResult,
} from "./frame.ts";
import { b1Factor, beamRelDeflection, cbFactor, interact, nominalStrong, nominalWeak } from "./steel.ts";
import { codeFindings } from "./review.ts";
import { designMembers } from "./design-members.ts";
import { solveFrame } from "./solve-frame.ts";

export type {
  Analysis,
  CheckRow,
  CodeCheck,
  ComboForce,
  DeckType,
  FrameInput,
  MemberGroup,
  MemberResult,
  SeismicMode,
  SoilType,
  StoryInfo,
  StrongAxis,
  StructMember,
  StructNode,
  SystemType,
} from "./frame.ts";
export { DEFAULT_INPUT, reflectionB, spectrumBN } from "./frame.ts";

export function analyze(raw: FrameInput): Analysis {
  const input = clampInput(raw);
  const built = build(input);
  const solved = solveFrame(input, built);
  if ("failed" in solved) return solved.failed;
  const { nodes, members } = built;
  const memberResults = designMembers({
    input,
    members,
    nodes,
    stories: solved.stories,
    gravityForces: solved.gravityForces,
    latForce: solved.latForce,
    evMag: solved.evMag,
    fL: solved.fL,
  });
  const { disp, stories, pack, Ta, Tray, H, W, deadDown, verticalReaction, gravityForces, evMag, fL } = solved;
  const maxRatio = memberResults.reduce((s, m) => Math.max(s, m.ratio), 0);
  const maxDrift = stories.reduce((s, st) => Math.max(s, st.driftRealX / st.limit, st.driftRealY / st.limit), 0);
  let maxDisp = 0;
  for (const key of ["ExP", "EyP"] as const) {
    for (let i = 0; i < nodes.length; i++) {
      maxDisp = Math.max(maxDisp, Math.hypot(disp[key][i * 6], disp[key][i * 6 + 1], disp[key][i * 6 + 2]));
    }
  }
  const steelKg = members.reduce((s, m) => s + sectionById(m.sectionId).weight * m.L, 0);

  const review = codeFindings({
    input,
    members,
    nodes,
    memberResults,
    stories,
    pack,
    Ta,
    Tray,
    maxDrift,
    maxRatio,
    evMag,
    fL,
    gravityForces,
  });
  const { codes, warnings, standardsOk, serviceOk, compactOk } = review;

  const note =
    input.seismicMode === "2800"
      ? `برش پایه استاتیکی معادل ۲۸۰۰. Ta=${Ta.toFixed(3)} s، رایلی=${Tray.toFixed(3)} s، T طرح=${pack.T.toFixed(3)} s (سقف ۱٫۲۵Ta). B=B1×N با N=${pack.N.toFixed(2)}${pack.Craw + 1e-9 < pack.Cmin ? " و کف ۰٫۱۲AI" : ""}. نیروها با دیافراگم ${input.diaphragm ? "صلب" : "انعطاف‌پذیر"}، پیچش تصادفی ۵٪ و ترکیب ۱۰۰٪+۳۰٪. اثر P-δ با B1 و P-Δ با B2.`
      : `ضریب C دستی است. Ta=${Ta.toFixed(3)} s و رایلی=${Tray.toFixed(3)} s فقط برای شناخت سختی‌اند. طراحی اعضا همچنان با ترکیب ۱۰۰٪+۳۰٪ و تشدید B1/B2 انجام می‌شود.`;

  return {
    input,
    nodes,
    members,
    disp,
    memberResults,
    stories,
    seismic: { H, T: pack.T, Ta, Tray, B: pack.B, N: pack.N, C: pack.C, k: pack.k, W, V: pack.V, note },
    steelKg,
    maxRatio,
    maxDrift,
    maxDisp,
    verticalLoad: deadDown,
    verticalReaction,
    stabilityOk: stories.every((s) => s.thetaOkX && s.thetaOkY),
    serviceOk,
    compactOk,
    standardsOk,
    codes,
    warnings,
    unstable: null,
    combos: [
      { id: "ExP", name: "زلزله X" },
      { id: "EyP", name: "زلزله Y" },
      { id: "D", name: "مرده" },
      { id: "L", name: "زنده" },
    ],
  };
}
const GROUP_FAMILY: Record<MemberGroup, Section["family"][]> = {
  column: ["HEB", "SHS"],
  beamX: ["IPE", "HEB"],
  beamY: ["IPE", "HEB"],
  brace: ["CHS"],
};

export function autoSize(raw: FrameInput): { input: FrameInput; passes: number; notes: string[] } {
  let cur = { ...raw };
  const notes: string[] = [];
  let passes = 0;
  let last: Analysis | null = null;
  for (let pass = 0; pass < 6; pass++) {
    passes = pass + 1;
    const res = analyze(cur);
    last = res;
    if (res.unstable) {
      notes.push(res.unstable);
      break;
    }
    let changed = false;
    const groups: MemberGroup[] = cur.system === "dual" ? ["column", "beamX", "beamY", "brace"] : ["column", "beamX", "beamY"];
    for (const group of groups) {
      const set = res.memberResults.filter((m) => m.group === group);
      if (!set.length) continue;
      const demand = set.reduce((a, b) => (a.ratio > b.ratio ? a : b));
      const catalog = sectionsOf(GROUP_FAMILY[group]);
      let pick = catalog[catalog.length - 1];
      for (const sec of catalog) {
        const K = group === "column" ? cur.Kcol : 1;
        const transverse = group === "beamX" || group === "beamY";
        const chk = checkCapacity(sec, demand.L, K, cur.fy, transverse, demand);
        if (chk <= 0.95) {
          pick = sec;
          break;
        }
      }
      const prev =
        group === "column" ? cur.columnSection : group === "beamX" ? cur.beamXSection : group === "beamY" ? cur.beamYSection : cur.braceSection;
      if (pick.id !== prev) {
        changed = true;
        if (group === "column") cur.columnSection = pick.id;
        if (group === "beamX") cur.beamXSection = pick.id;
        if (group === "beamY") cur.beamYSection = pick.id;
        if (group === "brace") cur.braceSection = pick.id;
        notes.push(`${labelGroup(group)} → ${pick.id}`);
      }
    }
    if (!changed) break;
  }
  if (last && !last.unstable) {
    if (last.maxDrift > 1) notes.push("مقاومت تنظیم شد، اما دریفت هنوز از حد ۲۸۰۰ بیشتر است.");
    if (!last.stabilityOk) notes.push("θ هنوز از θmax بیشتر است؛ سختی جانبی باید بیشتر شود.");
    if (!last.serviceOk) notes.push("افتادگی تیر هنوز از حد بهره‌برداری بیشتر است.");
    if (!last.compactOk) notes.push("فشردگی لرزه‌ای مقطع هنوز برقرار نیست.");
  }
  return { input: cur, passes, notes };
}

function checkCapacity(sec: Section, L: number, K: number, fy: number, transverse: boolean, demand: MemberResult) {
  const lb = transverse ? demand.lb : L;
  const cb = Number.isFinite(demand.cb) ? demand.cb : 1;
  const MnS = nominalStrong(sec, fy, lb, cb);
  const MnW = nominalWeak(sec, fy);
  return interact(sec, L, K, fy, demand.Pu, demand.Tu, demand.Mstrong, demand.Mweak, demand.V, 0.9 * MnS, 0.9 * MnW).ratio;
}

export function labelGroup(g: MemberGroup) {
  if (g === "column") return "ستون";
  if (g === "beamX") return "تیر راستای X";
  if (g === "beamY") return "تیر راستای Y";
  return "مهاربند";
}

export const __test = {
  localK,
  toGlobalK,
  applyR,
  equiv,
  mulK,
  cholesky,
  cholSolve,
  nominalStrong,
  nominalWeak,
  interact,
  cbFactor,
  b1Factor,
  beamRelDeflection,
};

export function summaryText(a: Analysis) {
  const lines = [
    "قاب‌سنج — خلاصه تحلیل و طراحی",
    `هندسه: ${a.input.nx} دهانه × ${a.input.ny} دهانه × ${a.input.stories} طبقه`,
    `دهانه ${a.input.bayX.toFixed(2)} × ${a.input.bayY.toFixed(2)} m ، ارتفاع طبقه ${a.input.storyH.toFixed(2)} m`,
    `سیستم: ${a.input.system === "dual" ? "دوگانه (خمشی + مهاربند ضربدری پیرامونی)" : "قاب خمشی"}`,
    `دیافراگم: ${a.input.diaphragm ? "صلب" : "انعطاف‌پذیر"} ، مهار بال بالای تیر: ${a.input.deckBrace ? "بله" : "خیر"}`,
    `H=${a.seismic.H.toFixed(2)} m  Ta=${a.seismic.Ta.toFixed(3)} s  Tرایلی=${a.seismic.Tray.toFixed(3)} s  Tطرح=${a.seismic.T.toFixed(3)} s`,
    `B=${a.seismic.B.toFixed(2)}  C=${a.seismic.C.toFixed(3)}  k=${a.seismic.k.toFixed(2)}  W=${a.seismic.W.toFixed(1)} kN  V=${a.seismic.V.toFixed(1)} kN`,
    `وزن فولاد ≈ ${(a.steelKg / 1000).toFixed(2)} ton`,
    `بیشینه نسبت اندرکنش = ${a.maxRatio.toFixed(2)}`,
    `تعادل قائم: بار ${a.verticalLoad.toFixed(1)} kN ، واکنش ${a.verticalReaction.toFixed(1)} kN`,
    "",
    "طبقات — دریفت غیرارتجاعی Cd·Δe·B2 و پایداری:",
    ...a.stories.map(
      (s) =>
        `طبقه ${s.level}: Δx=${(s.driftRealX * 1000).toFixed(1)} mm Δy=${(s.driftRealY * 1000).toFixed(1)} mm حد ${(s.limit * 1000).toFixed(0)} mm | θx=${s.thetaX.toFixed(3)} θy=${s.thetaY.toFixed(3)} θmax=${s.thetaMax.toFixed(3)} B2x=${s.B2x.toFixed(2)} B2y=${s.B2y.toFixed(2)}`,
    ),
    "",
    "بحرانی‌ترین اعضا (ترکیب ۱۰۰٪+۳۰٪، نیرو در مقطع حاکم):",
    ...[...a.memberResults]
      .sort((p, q) => q.ratio - p.ratio)
      .slice(0, 8)
      .map(
        (m) =>
          `${labelGroup(m.group)} ${m.sectionId} طبقه ${m.story}  نسبت ${m.ratio.toFixed(2)}  ${m.equation}  KL/r=${m.klr.toFixed(0)} Cb=${m.cb.toFixed(2)} B1=${m.b1.toFixed(2)}  (${m.combo})`,
      ),
    "",
    "روش: اجزای محدود مرتبه اول، دیافراگم صلب در صورت انتخاب، تشدید AISC B1 روی لنگر بدون انتقال جانبی و B2 روی سهم زلزله. طیف ۲۸۰۰ با B1×N و کف ۰٫۱۲AI. ظرفیت فشاری E3 با Q، خمش F2 با Cb، اندرکنش H1. این خروجی آموزشی است و جایگزین دفترچه ممهور نیست.",
    "بررسی استانداردها:",
    ...a.codes.map((c) => `${c.status === "pass" ? "قبول" : c.status === "fail" ? "رد" : "توضیح"}  ${c.clause} — ${c.title}`),
    "طراحی و تنظیم : یوسف بهرام بیگی",
  ];
  return lines.join("\n");
}
