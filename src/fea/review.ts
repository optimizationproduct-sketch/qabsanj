import { sectionById } from "./sections.ts";
import {
  hazardHigh,
  type CodeCheck,
  type EndForce,
  type FrameInput,
  type MemberResult,
  type StoryInfo,
  type StructMember,
  type StructNode,
} from "./frame.ts";
import { beamRelDeflection, ductilityOf, fyOf, sectionSeismicOk } from "./steel.ts";

export function codeFindings(ctx: {
  input: FrameInput;
  members: StructMember[];
  nodes: StructNode[];
  memberResults: MemberResult[];
  stories: StoryInfo[];
  pack: { T: number; B: number; N: number; B1: number; C: number; Craw: number; Cmin: number };
  Ta: number;
  Tray: number;
  maxDrift: number;
  maxRatio: number;
  evMag: number;
  fL: number;
  gravityForces: (D: number, L: number) => EndForce[];
}): { codes: CodeCheck[]; warnings: string[]; standardsOk: boolean; serviceOk: boolean; compactOk: boolean } {
  const { input, members, nodes, memberResults, stories, pack, Ta, Tray, maxDrift, maxRatio, evMag, fL, gravityForces } = ctx;
  let serviceLive = 0;
  let serviceTotal = 0;
  const liveF = gravityForces(0, 1);
  const servF = gravityForces(1, 1);
  members.forEach((m, e) => {
    if (m.group !== "beamX" && m.group !== "beamY") return;
    const sec = sectionById(m.sectionId);
    const deflect = (fr: EndForce) => {
      const My0 = -fr.f[4];
      const MyL = -fr.f[4] - m.L * fr.f[2] - (fr.qz * m.L * m.L) / 2;
      return beamRelDeflection(m.L, fr.qz, My0, MyL, sec.Iy);
    };
    serviceLive = Math.max(serviceLive, (deflect(liveF[e]) * 360) / m.L);
    serviceTotal = Math.max(serviceTotal, (deflect(servF[e]) * 240) / m.L);
  });
  const serviceOk = serviceLive <= 1 + 1e-6 && serviceTotal <= 1 + 1e-6;

  const duct = ductilityOf(input);
  const compactFails = memberResults.filter((m) => {
    const sec = sectionById(m.sectionId);
    const Py = fyOf(input.fy) * sec.A;
    const Ca = m.Pu / Math.max(0.9 * Py, 1e-9);
    return !sectionSeismicOk(sec, input.fy, duct, Ca, m.group);
  });
  const compactOk = compactFails.length === 0;

  const Ry = input.fy <= 250 ? 1.2 : 1.15;
  const fyK = fyOf(input.fy);
  const byMem = new Map(memberResults.map((m) => [m.id, m]));
  let scwbMin = Infinity;
  let scwbWhere = "";
  let scwbN = 0;
  for (const node of nodes) {
    if (node.base || node.story >= input.stories) continue;
    for (const plane of [
      { group: "beamX" as const, alongStrong: input.strongAlong === "X", name: "X" },
      { group: "beamY" as const, alongStrong: input.strongAlong === "Y", name: "Y" },
    ]) {
      const beams = members.filter((m) => m.group === plane.group && (m.i === node.id || m.j === node.id));
      const cols = members.filter((m) => m.group === "column" && (m.i === node.id || m.j === node.id));
      if (!beams.length || !cols.length) continue;
      let mpb = 0;
      for (const b of beams) mpb += 1.1 * Ry * fyK * sectionById(b.sectionId).Zy;
      let mpc = 0;
      for (const c of cols) {
        const sec = sectionById(c.sectionId);
        const Z = plane.alongStrong ? sec.Zy : sec.Zz;
        const Pu = byMem.get(c.id)?.Pu ?? 0;
        mpc += fyK * Z * Math.max(0, 1 - Pu / Math.max(fyK * sec.A, 1e-9));
      }
      if (mpb < 1e-6) continue;
      const r = mpc / mpb;
      scwbN++;
      if (r < scwbMin) {
        scwbMin = r;
        scwbWhere = `طبقه ${node.story} راستای ${plane.name}`;
      }
    }
  }
  if (!Number.isFinite(scwbMin)) scwbMin = 1;
  const special = duct === "ویژه";
  const scwbOk = !special || scwbMin + 1e-6 >= 1;

  const klrBad = memberResults.filter((m) => (m.group === "column" || m.group === "brace") && m.klr > 200);
  const shearBad = memberResults.some((m) => m.equation === "G2" && m.ratio > 1);

  const codes: CodeCheck[] = [
    {
      id: "combo",
      clause: "مبحث ششم",
      title: "ترکیب بار مقاومت",
      status: "pass",
      detail: fL < 1
        ? "۱٫۴D ، ۱٫۲D+۱٫۶L ، ۱٫۲D+۰٫۵L+E و ۰٫۹D+E. بار زنده کف از ۵ کیلونیوتن بر مترمربع کمتر است، پس ضریب L در ترکیب لرزه‌ای ۰٫۵ است. برف و باد در این مدل نیست."
        : "۱٫۴D ، ۱٫۲D+۱٫۶L ، ۱٫۲D+L+E و ۰٫۹D+E. بار زنده از ۵ کیلونیوتن بر مترمربع بیشتر است، پس ضریب L در ترکیب لرزه‌ای ۱ می‌ماند. برف و باد نیست.",
    },
    {
      id: "orth",
      clause: "۲۸۰۰ بند ۳-۱-۴",
      title: "زلزله متعامد",
      status: "pass",
      detail: "۱۰۰٪ یک راستا به‌علاوه ۳۰٪ راستای دیگر، با هر دو علامت خروج از مرکزیت ۵٪.",
    },
    {
      id: "rho",
      clause: "۲۸۰۰ بند ۳-۲",
      title: "ضریب نامعینی",
      status: "info",
      detail:
        input.nx >= 4 && input.ny >= 4
          ? "در هر راستا دست‌کم چهار دهانه هست؛ دو دهانه در هر سمت مرکز جرم برقرار است و ρ برابر ۱ گرفته شده."
          : "ρ برابر ۱ فرض شده. اگر در هر سمت مرکز جرم دو دهانه مقاوم نباشد، یا باید حذف یک عضو کنترل شود یا نیروی جانبی در ۱٫۲ ضرب شود. حذف عضو در این مدل انجام نشده.",
    },
    {
      id: "spectrum",
      clause: "۲۸۰۰ بند ۲",
      title: "طیف بازتاب B",
      status: input.seismicMode === "2800" ? "pass" : "info",
      detail:
        input.seismicMode === "2800"
          ? `خاک ${input.soil}، ${hazardHigh(input.A) ? "خطر زیاد یا خیلی‌زیاد" : "خطر کم یا متوسط"}. B1=${pack.B1.toFixed(2)}، N=${pack.N.toFixed(2)}، B=${pack.B.toFixed(2)}، C=${pack.C.toFixed(3)}${pack.Craw + 1e-9 < pack.Cmin ? " (کف ۰٫۱۲AI حاکم است)" : ""}.`
          : "C را خودتان داده‌اید؛ طیف ۲۸۰۰ در برش پایه خاموش است.",
    },
    {
      id: "period",
      clause: "۲۸۰۰ بند ۳-۳",
      title: "زمان تناوب طرح",
      status: pack.T <= Ta * 1.25 + 1e-6 ? "pass" : "fail",
      detail: `Ta=${Ta.toFixed(3)} s، رایلی=${Tray.toFixed(3)} s، T طرح=${pack.T.toFixed(3)} s. سقف مجاز ۱٫۲۵Ta است.`,
    },
    {
      id: "ev",
      clause: "۲۸۰۰ بند ۳-۳-۹",
      title: "مؤلفه قائم",
      status: "info",
      detail: evMag > 0
        ? `A≥۰٫۳۵ است؛ Ev=۰٫۶AI=${evMag.toFixed(2)} برابر بار مرده، با هر دو علامت، به ترکیب‌های لرزه‌ای اضافه شد.`
        : "برای خطر خیلی زیاد (A≥۰٫۳۵) یا دهانه بیش از ۱۵ متر لازم است. در این مدل اعمال نشده.",
    },
    {
      id: "drift",
      clause: "۲۸۰۰ بند ۳-۵",
      title: "دریفت غیرارتجاعی",
      status: maxDrift <= 1 ? "pass" : "fail",
      detail: `بیشینه Δ/(حد)=${maxDrift.toFixed(2)}. حد ${input.stories <= 5 ? "۰٫۰۲۵h" : "۰٫۰۲۰h"} و Δ=Cd·Δe·B2.`,
    },
    {
      id: "theta",
      clause: "۲۸۰۰ بند ۳-۵",
      title: "ضریب پایداری θ",
      status: stories.every((s) => s.thetaOkX && s.thetaOkY) ? "pass" : "fail",
      detail: `P بار ثقلی بهره‌برداری D+L است، نه وزن لرزه‌ای D+ψL. θmax=${stories[0]?.thetaMax.toFixed(3) ?? "—"} با β=۱. اگر θ>۰٫۱ باشد B2=1/(1−θ).`,
    },
    {
      id: "h1",
      clause: "مبحث دهم H1",
      title: "اندرکنش نیروی محوری و خمش",
      status: maxRatio <= 1 ? "pass" : "fail",
      detail: `بیشینه نسبت ${maxRatio.toFixed(2)}. φc=φb=φt=۰٫۹. فشار از منحنی E3 با Q، خمش از F2 با Cb.`,
    },
    {
      id: "klr",
      clause: "مبحث دهم E2",
      title: "لاغری فشاری",
      status: klrBad.length ? "fail" : "pass",
      detail: klrBad.length
        ? `${klrBad.length} عضو با KL/r بیش از ۲۰۰.`
        : "KL/r اعضای فشاری از ۲۰۰ بیشتر نیست. حد ترجیحی کشش ۳۰۰ جدا چک نشده.",
    },
    {
      id: "shear",
      clause: "مبحث دهم G",
      title: "برش",
      status: shearBad ? "fail" : "pass",
      detail: "جان تیر I با φv=۱ اگر h/tw کم باشد، وگرنه ۰٫۹. برش همزمان با اندرکنش سنجیده می‌شود.",
    },
    {
      id: "defl",
      clause: "مبحث دهم بهره‌برداری",
      title: "افتادگی تیر",
      status: serviceOk ? "pass" : "fail",
      detail: `زنده L/360 نسبت ${serviceLive.toFixed(2)} ، بار کل L/240 نسبت ${serviceTotal.toFixed(2)}. خیز نسبت به وتر، با لنگر دو انتها.`,
    },
    {
      id: "compact",
      clause: "مبحث دهم فصل لرزه‌ای",
      title: `فشردگی لرزه‌ای (${duct})`,
      status: duct === "معمولی" ? "info" : compactOk ? "pass" : "fail",
      detail:
        duct === "معمولی"
          ? "با این R، حد فشردگی لرزه‌ای متوسط یا ویژه الزام نشده."
          : compactOk
            ? `مقاطع در حد شکل‌پذیری ${duct} هستند.`
            : `${compactFails.length} عضو از حد بال یا جان شکل‌پذیری ${duct} رد شده، از جمله ${compactFails[0]?.sectionId ?? ""}.`,
    },
    {
      id: "scwb",
      clause: "مبحث دهم ۱۰-۳",
      title: "ستون قوی و تیر ضعیف",
      status: special ? (scwbOk ? "pass" : "fail") : scwbMin + 1e-6 >= 1 ? "pass" : "info",
      detail: scwbN
        ? `کمینه ΣMpc/ΣMpb=${scwbMin.toFixed(2)} در ${scwbWhere}. Ry=${Ry}. طبقه بام معاف است. ${special ? "برای قاب ویژه باید حداقل ۱ باشد." : "برای قاب متوسط الزام آیین‌نامه نیست؛ فقط گزارش شده."}`
        : input.stories <= 1
          ? "ساختمان یک‌طبقه است و طبقه بام از کنترل ستون قوی معاف است."
          : "گره قاب زیر طبقه بام برای این کنترل پیدا نشد.",
    },
    {
      id: "scope",
      clause: "خارج از دامنه",
      title: "اتصال، چشمه اتصال، کف‌ستون",
      status: "info",
      detail: "اتصال گیردار، چشمه اتصال، ورق پیوستگی، مهاربند و کف‌ستون طراحی نمی‌شوند. خروجی جای دفترچه ممهور را نمی‌گیرد.",
    },
  ];
  const standardsOk = codes.every((c) => c.status !== "fail");

  const warnings: string[] = [];
  if (maxRatio > 1) warnings.push("دست‌کم یک عضو نسبت اندرکنش بیش از یک دارد.");
  if (maxDrift > 1) warnings.push("دریفت غیرارتجاعی طبقه از حد استاندارد ۲۸۰۰ بیشتر است.");
  const weakStory = stories.filter((s) => !s.thetaOkX || !s.thetaOkY).map((s) => s.level);
  if (weakStory.length) warnings.push(`ضریب پایداری θ در طبقه ${weakStory.join("، ")} از θmax بیشتر است. تشدید B2 کافی نیست و سختی جانبی باید زیاد شود.`);
  if (!serviceOk) warnings.push("افتادگی تیر از حد بهره‌برداری مبحث دهم بیشتر است.");
  if (!compactOk && duct !== "معمولی") warnings.push(`مقطع از فشردگی لرزه‌ای شکل‌پذیری ${duct} رد شده است.`);
  if (special && !scwbOk) warnings.push("نسبت ستون قوی به تیر ضعیف در قاب ویژه کمتر از یک است.");
  if (klrBad.length) warnings.push("لاغری فشاری KL/r از ۲۰۰ بیشتر است.");
  if (memberResults.some((m) => m.slenderQ < 0.98 && m.ratio > 0.4)) warnings.push("جداره لاغر در فشار با ضریب Q کاهش ظرفیت داده شده است.");
  return { codes, warnings, standardsOk, serviceOk, compactOk };
}
