import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  analyze,
  autoSize,
  DEFAULT_INPUT,
  labelGroup,
  summaryText,
  type Analysis,
  type FrameInput,
} from "@/fea/analyze";
import { SECTIONS, STEELS, sectionsOf, type Section } from "@/fea/sections";
import { FrameView } from "@/components/viewer";

const KEY = "qabsanj-model-v1";

const PRESETS: { id: string; name: string; patch: Partial<FrameInput> }[] = [
  {
    id: "home",
    name: "مسکونی",
    patch: {
      nx: 3,
      ny: 2,
      stories: 4,
      bayX: 6,
      bayY: 5,
      storyH: 3.2,
      system: "moment",
      columnSection: "HEB240",
      beamXSection: "IPE330",
      beamYSection: "IPE300",
      qd: 5.5,
      ql: 2,
      R: 5,
      Cd: 4,
    },
  },
  {
    id: "portal",
    name: "یک دهانه",
    patch: {
      nx: 1,
      ny: 1,
      stories: 1,
      bayX: 6,
      bayY: 6,
      storyH: 3.5,
      system: "moment",
      columnSection: "HEB200",
      beamXSection: "IPE300",
      beamYSection: "IPE300",
    },
  },
  {
    id: "tower",
    name: "شش‌طبقه",
    patch: {
      nx: 3,
      ny: 3,
      stories: 6,
      bayX: 5,
      bayY: 5,
      storyH: 3.2,
      system: "moment",
      columnSection: "HEB300",
      beamXSection: "IPE360",
      beamYSection: "IPE360",
      R: 7.5,
      Cd: 5.5,
    },
  },
  {
    id: "dual",
    name: "دوگانه",
    patch: {
      nx: 3,
      ny: 2,
      stories: 4,
      system: "dual",
      R: 6,
      Cd: 5,
      braceSection: "CHS219x8",
    },
  },
];

function loadInput(): FrameInput {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_INPUT;
    return { ...DEFAULT_INPUT, ...(JSON.parse(raw) as Partial<FrameInput>) };
  } catch {
    return DEFAULT_INPUT;
  }
}

function num(v: number, d = 1) {
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
}

function Mark() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
      <rect x="3" y="3" width="26" height="26" rx="6" fill="var(--color-surface-2)" />
      <path d="M8 24 V10 H14 V24 M18 24 V14 H24 V24 M8 16 H24" stroke="var(--color-copper)" strokeWidth="1.7" fill="none" />
    </svg>
  );
}

export function Studio() {
  const [input, setInput] = useState<FrameInput>(loadInput);
  const [result, setResult] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState(true);
  const [tab, setTab] = useState<"geo" | "load" | "out" | "design">("geo");
  const [combo, setCombo] = useState("ExP");
  const [deformed, setDeformed] = useState(false);
  const [scale, setScale] = useState(1);
  const [slabs, setSlabs] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const [toast, setToast] = useState("");
  const [designNotes, setDesignNotes] = useState<string[]>([]);

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(input));
  }, [input]);

  useEffect(() => {
    let cancel = false;
    setBusy(true);
    const t = window.setTimeout(() => {
      const next = analyze(input);
      if (cancel) return;
      setResult(next);
      setBusy(false);
      setSelected((id) => (id !== null && id < next.members.length ? id : null));
    }, 30);
    return () => {
      cancel = true;
      window.clearTimeout(t);
    };
  }, [input]);

  const patch = (p: Partial<FrameInput>) => setInput((s) => ({ ...s, ...p }));
  const member = result?.memberResults.find((m) => m.id === selected) ?? null;
  const ranked = useMemo(
    () => (result ? [...result.memberResults].sort((a, b) => b.ratio - a.ratio).slice(0, 8) : []),
    [result],
  );

  const status = !result
    ? { text: "تحلیل", cls: "" }
    : result.unstable
      ? { text: "ناپایدار", cls: "bad" }
      : !result.standardsOk
        ? { text: "نیاز به تقویت", cls: "bad" }
        : { text: "پاسخگو", cls: "ok" };

  const runDesign = () => {
    setBusy(true);
    window.setTimeout(() => {
      const out = autoSize(input);
      setDesignNotes(out.notes);
      setInput(out.input);
      setTab("design");
    }, 20);
  };

  const copySummary = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(summaryText(result));
      setToast("خلاصه کپی شد");
      window.setTimeout(() => setToast(""), 1600);
    } catch {
      setToast("کپی ممکن نشد");
      window.setTimeout(() => setToast(""), 1600);
    }
  };

  return (
    <div className="studio">
      <header className="topbar">
        <div className="brand">
          <Mark />
          <div>
            <h1>قاب‌سنج</h1>
            <p>قاب سه‌بعدی · مبحث دهم · استاندارد ۲۸۰۰</p>
            <p className="credit">طراحی و تنظیم : یوسف بهرام بیگی</p>
          </div>
        </div>
        <span className={`chip ${status.cls}`}>{busy ? "در حال تحلیل" : status.text}</span>
      </header>

      <div className="stage">
        <FrameView
          analysis={result}
          selected={selected}
          onSelect={(id) => {
            setSelected(id);
            if (id !== null) setTab("out");
          }}
          combo={combo}
          deformed={deformed}
          scale={scale}
          slabs={slabs}
        />
        <div className="overlay">
          <div className="chips">
            {(
              [
                ["ExP", "زلزله X"],
                ["EyP", "زلزله Y"],
                ["D", "بار مرده"],
                ["L", "بار زنده"],
              ] as const
            ).map(([id, name]) => (
              <button key={id} type="button" className="chip-btn" data-on={combo === id} onClick={() => setCombo(id)}>
                {name}
              </button>
            ))}
          </div>
          <div className="overlay-foot">
            <div className="legend">
              <span>
                <i className="swatch" style={{ background: "var(--color-steel)" }} /> کم
              </span>
              <span>
                <i className="swatch" style={{ background: "var(--color-ok)" }} /> حدود ۰٫۶
              </span>
              <span>
                <i className="swatch" style={{ background: "var(--color-copper)" }} /> نزدیک یک
              </span>
              <span>
                <i className="swatch" style={{ background: "var(--color-bad)" }} /> بیش از ظرفیت
              </span>
            </div>
            <div className="overlay-actions">
              <div className="flex gap-1">
                <button type="button" className="ghost" data-on={deformed} onClick={() => setDeformed((v) => !v)}>
                  تغییرشکل
                </button>
                <button type="button" className="ghost" data-on={slabs} onClick={() => setSlabs((v) => !v)}>
                  سقف
                </button>
              </div>
              {deformed && (
                <label className="scale-box">
                  مقیاس
                  <input type="range" min={0.2} max={2.5} step={0.1} value={scale} onChange={(e) => setScale(Number(e.target.value))} />
                </label>
              )}
            </div>
          </div>
        </div>
        {toast && <div className="toast">{toast}</div>}
      </div>

      <aside className="dock">
        <div className="tabs" role="tablist">
          {(
            [
              ["geo", "هندسه"],
              ["load", "بار"],
              ["out", "نتایج"],
              ["design", "طراحی"],
            ] as const
          ).map(([id, name]) => (
            <button key={id} type="button" role="tab" data-on={tab === id} onClick={() => setTab(id)}>
              {name}
            </button>
          ))}
        </div>
        <div className="dock-body">
          {tab === "geo" && (
            <>
              <div className="presets">
                {PRESETS.map((p) => (
                  <button key={p.id} type="button" className="chip-btn" onClick={() => patch(p.patch)}>
                    {p.name}
                  </button>
                ))}
              </div>
              <div className="grid-2">
                <Stepper label="دهانه X" value={input.nx} min={1} max={4} onChange={(nx) => patch({ nx })} />
                <Stepper label="دهانه Y" value={input.ny} min={1} max={4} onChange={(ny) => patch({ ny })} />
                <Stepper label="طبقه" value={input.stories} min={1} max={6} onChange={(stories) => patch({ stories })} />
                <Field label="ارتفاع طبقه" unit="m" value={input.storyH} step={0.1} onChange={(storyH) => patch({ storyH })} />
                <Field label="عرض دهانه X" unit="m" value={input.bayX} step={0.1} onChange={(bayX) => patch({ bayX })} />
                <Field label="عرض دهانه Y" unit="m" value={input.bayY} step={0.1} onChange={(bayY) => patch({ bayY })} />
              </div>
              <SectionField label="ستون" value={input.columnSection} families={["HEB", "SHS"]} onChange={(columnSection) => patch({ columnSection })} />
              <SectionField label="تیر راستای X" value={input.beamXSection} families={["IPE", "HEB"]} onChange={(beamXSection) => patch({ beamXSection })} />
              <SectionField label="تیر راستای Y" value={input.beamYSection} families={["IPE", "HEB"]} onChange={(beamYSection) => patch({ beamYSection })} />
              <label className="field">
                <span>محور قوی ستون در برابر جابه‌جایی</span>
                <select value={input.strongAlong} onChange={(e) => patch({ strongAlong: e.target.value as FrameInput["strongAlong"] })}>
                  <option value="X">راستای X</option>
                  <option value="Y">راستای Y</option>
                </select>
              </label>
              <label className="field">
                <span>سیستم سازه‌ای</span>
                <select value={input.system} onChange={(e) => patch({ system: e.target.value as FrameInput["system"] })}>
                  <option value="moment">قاب خمشی</option>
                  <option value="dual">دوگانه؛ خمشی به‌علاوه ضربدری پیرامونی</option>
                </select>
              </label>
              {input.system === "dual" && (
                <SectionField label="مهاربند" value={input.braceSection} families={["CHS"]} onChange={(braceSection) => patch({ braceSection })} />
              )}
              <p className="note">
                هر عضو تیر-ستون دوازده درجه آزادی دارد و پای ستون‌ها گیردار است. با دیافراگم صلب، سقف هر طبقه در صفحه خودش یکجا حرکت می‌کند. رنگ اعضا نسبت اندرکنش بحرانی است.
                {result && ` این مدل ${result.nodes.length} گره و ${result.members.length} عضو دارد.`}
              </p>
            </>
          )}

          {tab === "load" && (
            <>
              <div className="grid-2">
                <Field label="مرده کف" unit="kN/m²" value={input.qd} step={0.1} onChange={(qd) => patch({ qd })} />
                <Field label="زنده کف" unit="kN/m²" value={input.ql} step={0.1} onChange={(ql) => patch({ ql })} />
                <Field label="ضریب زنده لرزه‌ای" value={input.psi} step={0.05} onChange={(psi) => patch({ psi })} />
                <label className="field">
                  <span>جهت عرشه</span>
                  <select value={input.deck} onChange={(e) => patch({ deck: e.target.value as FrameInput["deck"] })}>
                    <option value="two-way">دوطرفه</option>
                    <option value="x-beams">یک‌طرفه روی تیرهای X</option>
                    <option value="y-beams">یک‌طرفه روی تیرهای Y</option>
                  </select>
                </label>
              </div>
              <label className="member-btn" data-on={input.selfWeight}>
                <input type="checkbox" checked={input.selfWeight} onChange={(e) => patch({ selfWeight: e.target.checked })} />
                وزن اسکلت در بار مرده و وزن لرزه‌ای
              </label>
              <label className="field">
                <span>برش پایه</span>
                <select value={input.seismicMode} onChange={(e) => patch({ seismicMode: e.target.value as FrameInput["seismicMode"] })}>
                  <option value="2800">استاندارد ۲۸۰۰، استاتیکی معادل</option>
                  <option value="coeff">ضریب C دستی</option>
                </select>
              </label>
              {input.seismicMode === "2800" ? (
                <div className="grid-2">
                  <Field label="شتاب مبنا A" value={input.A} step={0.05} onChange={(A) => patch({ A })} />
                  <Field label="اهمیت I" value={input.Iimp} step={0.1} onChange={(Iimp) => patch({ Iimp })} />
                  <Field label="ضریب رفتار R" value={input.R} step={0.5} onChange={(R) => patch({ R })} />
                  <Field label="Cd دریفت" value={input.Cd} step={0.5} onChange={(Cd) => patch({ Cd })} />
                  <label className="field">
                    <span>خاک</span>
                    <select value={input.soil} onChange={(e) => patch({ soil: e.target.value as FrameInput["soil"] })}>
                      <option value="I">تیپ I</option>
                    <option value="II">تیپ II</option>
                      <option value="III">تیپ III</option>
                      <option value="IV">تیپ IV</option>
                    </select>
                  </label>
                </div>
              ) : (
                <Field label="C = V/W" value={input.C} step={0.01} onChange={(C) => patch({ C })} />
              )}
              {result && (
                <div className="card">
                  <h3>برش پایه</h3>
                  <p className="note">{result.seismic.note}</p>
                  <p className="note tabular-nums">
                    H={num(result.seismic.H, 2)} m · Ta={num(result.seismic.Ta, 2)} s · T رایلی={num(result.seismic.Tray, 2)} s · T طرح={num(result.seismic.T, 2)} s
                    <br />
                    B={num(result.seismic.B, 2)} · N={num(result.seismic.N, 2)} · k={num(result.seismic.k, 2)} · C={num(result.seismic.C, 3)} · W={num(result.seismic.W, 0)} kN · V={num(result.seismic.V, 0)} kN
                  </p>
                  <div className="h-36">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={result.stories.map((s) => ({ name: String(s.level), Fx: Math.round(s.Fx) }))}>
                        <XAxis dataKey="name" stroke="var(--color-muted)" fontSize={11} />
                        <YAxis stroke="var(--color-muted)" fontSize={11} width={42} />
                        <Tooltip
                          formatter={(v) => [`${v} kN`, "نیروی طبقه"]}
                          contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-line)", borderRadius: 8 }}
                        />
                        <Bar dataKey="Fx" fill="var(--color-copper)" radius={4} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </>
          )}

          {tab === "out" && result && (
            <>
              {result.warnings.map((w) => (
                <p key={w} className="warn">
                  {w}
                </p>
              ))}
              <div className="metrics">
                <Metric label="بیشینه اندرکنش" value={num(result.maxRatio, 2)} bad={result.maxRatio > 1} ok={result.maxRatio <= 1 && !!result} />
                <Metric label="دریفت / حد" value={num(result.maxDrift, 2)} bad={result.maxDrift > 1} ok={result.maxDrift <= 1} />
                <Metric label="پایداری θ" value={result.stabilityOk ? "قبول" : "رد"} bad={!result.stabilityOk} ok={result.stabilityOk} />
                <Metric label="وزن فولاد" value={`${num(result.steelKg / 1000, 2)} t`} />
              </div>
              <p className="note tabular-nums">
                تعادل قائم بار مرده: بار {num(result.verticalLoad, 1)} kN و واکنش تکیه‌گاه {num(result.verticalReaction, 1)} kN. شکل تغییرمکان‌یافته مرتبه اول است؛ P-Δ داخل نیروها با B2 آمده.
              </p>
              {member && (
                <div className="card">
                  <h3>
                    {labelGroup(member.group)} · {member.sectionId}
                    <span className="text-muted"> · طبقه {member.story}</span>
                  </h3>
                  <p className="note">
                    {member.governing}
                    <br />
                    ترکیب حاکم: {member.combo}
                  </p>
                  <p className="note tabular-nums">
                    Pu {num(member.Pu, 1)} / φPn {num(member.phiPn, 0)} kN
                    <br />
                    Tu {num(member.Tu, 1)} / φTn {num(member.phiTn, 0)} kN
                    <br />
                    لنگر قوی {num(member.Mstrong, 1)} / φMn {num(member.phiMnS, 1)} kN·m
                    <br />
                    لنگر ضعیف {num(member.Mweak, 1)} / φMn {num(member.phiMnW, 1)} kN·m
                    <br />
                    Vu {num(member.V, 1)} / φVn {num(member.phiVn, 0)} kN
                  </p>
                  <div className="checks">
                    {member.checks.map((c) => (
                      <div key={c.label} className="check-row">
                        <span>{c.label}</span>
                        <Ratio ratio={c.ratio} />
                      </div>
                    ))}
                  </div>
                  <p className="note tabular-nums">
                    KL/r={num(member.klr, 0)} · Cb={num(member.cb, 2)} · B1={num(member.b1, 2)} · Lb={num(member.lb, 2)} m
                    {member.slenderQ < 0.999 ? ` · Q=${num(member.slenderQ, 2)}` : ""}
                  </p>
                  <Ratio ratio={member.ratio} />
                </div>
              )}
              <div className="flex flex-col gap-2">
                {ranked.map((m) => (
                  <button key={m.id} type="button" className="member-btn" data-on={selected === m.id} onClick={() => setSelected(m.id)}>
                    <span>
                      {labelGroup(m.group)} {m.sectionId}
                      <small className="block text-muted">طبقه {m.story}</small>
                    </span>
                    <Ratio ratio={m.ratio} />
                  </button>
                ))}
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>طبقه</th>
                      <th>θx</th>
                      <th>θy</th>
                      <th>Δx</th>
                      <th>Δy</th>
                      <th>حد</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.stories.map((s) => (
                      <tr key={s.level}>
                        <td>{s.level}</td>
                        <td className={s.thetaOkX ? "" : "text-bad"}>{num(s.thetaX, 3)}</td>
                        <td className={s.thetaOkY ? "" : "text-bad"}>{num(s.thetaY, 3)}</td>
                        <td className={s.okX ? "" : "text-bad"}>{num(s.driftRealX * 1000, 1)}</td>
                        <td className={s.okY ? "" : "text-bad"}>{num(s.driftRealY * 1000, 1)}</td>
                        <td>{num(s.limit * 1000, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="note">
                دریفت‌ها میلی‌متر و برابر Cd×Δe×B2 هستند. حد تا پنج طبقه ۰٫۰۲۵h و بعد از آن ۰٫۰۲۰h است. θmax=min(۰٫۲۵، ۰٫۵/Cd). اگر θ از ۰٫۱ بگذرد و گزینه P-Δ روشن باشد، B2=1/(1−θ) فقط روی سهم زلزله اعمال می‌شود.
              </p>
              <button type="button" className="ghost" onClick={() => void copySummary()}>
                کپی خلاصه محاسبات
              </button>
            </>
          )}

          {tab === "design" && (
            <>
              <label className="field">
                <span>فولاد</span>
                <select value={String(input.fy)} onChange={(e) => patch({ fy: Number(e.target.value) })}>
                  {STEELS.map((s) => (
                    <option key={s.id} value={s.fy}>
                      {s.name} · Fy={s.fy} MPa
                    </option>
                  ))}
                </select>
              </label>
              <Field label="ضریب طول مؤثر ستون K" value={input.Kcol} step={0.1} onChange={(Kcol) => patch({ Kcol })} />
              <label className="member-btn" data-on={input.pdelta}>
                <input type="checkbox" checked={input.pdelta} onChange={(e) => patch({ pdelta: e.target.checked })} />
                تشدید P-Δ با B2 وقتی θ از ۰٫۱ بیشتر شود
              </label>
              <label className="member-btn" data-on={input.diaphragm}>
                <input type="checkbox" checked={input.diaphragm} onChange={(e) => patch({ diaphragm: e.target.checked })} />
                دیافراگم صلب سقف
              </label>
              <label className="member-btn" data-on={input.deckBrace}>
                <input type="checkbox" checked={input.deckBrace} onChange={(e) => patch({ deckBrace: e.target.checked })} />
                سقف، بال فشاری بالای تیر را مهار می‌کند
              </label>
              <button type="button" className="primary" onClick={runDesign} disabled={busy}>
                طراحی خودکار مقاطع
              </button>
              {designNotes.length > 0 && (
                <div className="card">
                  <h3>آخرین چرخه طراحی</h3>
                  {designNotes.map((n) => (
                    <p key={n} className="note">
                      {n}
                    </p>
                  ))}
                </div>
              )}
              {result && (
                <div className="metrics">
                  <Metric label="اندرکنش" value={num(result.maxRatio, 2)} bad={result.maxRatio > 1} ok={result.maxRatio <= 1} />
                  <Metric label="دریفت" value={result.maxDrift <= 1 ? "قبول" : "رد"} bad={result.maxDrift > 1} ok={result.maxDrift <= 1} />
                  <Metric label="پایداری" value={result.stabilityOk ? "قبول" : "رد"} bad={!result.stabilityOk} ok={result.stabilityOk} />
                  <Metric label="برش پایه" value={`${num(result.seismic.V, 0)} kN`} />
                </div>
              )}
              {result && (
                <div className="card">
                  <h3>بررسی استانداردها</h3>
                  {result.codes.map((c) => (
                    <div key={c.id} className="std-row" data-st={c.status}>
                      <b>{c.status === "pass" ? "قبول" : c.status === "fail" ? "رد" : "توضیح"}</b>
                      <span>
                        <strong>{c.clause}</strong>
                        {" · "}
                        {c.title}
                        <small>{c.detail}</small>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <details>
                <summary>روش تحلیل و طراحی</summary>
                <p className="note">
                  سختی در دستگاه محلی ساخته و به کل منتقل می‌شود. پای ستون گیردار است. اگر دیافراگم صلب روشن باشد، گره‌های هر سقف در ux و uy و پیچش درون‌صفحه به هم بسته‌اند. بار کف با سطح باربر ذوزنقه‌ای یا یک‌طرفه روی تیرها می‌نشیند.
                  برش پایه از ۲۸۰۰ است: B برابر B1 ضرب در N، و C دست‌کم ۰٫۱۲AI. زمان تناوب طرح کمینهٔ رایلی و ۱٫۲۵ برابر Ta تجربی است. توزیع ارتفاعی با توان k و خروج از مرکزیت تصادفی ۵٪ است. طراحی عضو با ترکیب‌های مبحث ششم به‌اضافه ۱۰۰٪+۳۰٪ انجام می‌شود. اگر بار زنده کف از ۵ کیلونیوتن بر مترمربع کمتر باشد، ضریب آن در ترکیب لرزه‌ای ۰٫۵ است.
                  ظرفیت فشاری منحنی E3 با اثر جداره لاغر Q، خمش تیر I با کمانش جانبی-پیچشی و Cb، و اندرکنش H1 است. لنگر ثقلی با B1 و سهم زلزله با B2 همان طبقه تشدید می‌شود، نه هر دو با هم روی کل لنگر. بال بالای تیر در لنگر مثبت، در صورت انتخاب، مهارشده فرض می‌شود و بال پایین در ناحیه لنگر منفی با طول همان ناحیه کنترل می‌شود. این ابزار جای دفترچه ممهور را نمی‌گیرد.
                </p>
              </details>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function Metric({ label, value, bad, ok }: { label: string; value: string; bad?: boolean; ok?: boolean }) {
  return (
    <div className={`metric ${bad ? "bad" : ""} ${ok ? "ok" : ""}`}>
      <em>{label}</em>
      <strong>{value}</strong>
    </div>
  );
}

function Ratio({ ratio }: { ratio: number }) {
  const cls = ratio > 1 ? "bad" : ratio > 0.85 ? "" : "ok";
  return (
    <span className="flex items-center gap-2">
      <span className={`bar ${cls}`}>
        <i style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </span>
      <b>{num(ratio, 2)}</b>
    </span>
  );
}

function Field({
  label,
  value,
  onChange,
  step,
  unit,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step: number;
  unit?: string;
}) {
  return (
    <label className="field">
      <span>
        {label}
        {unit ? ` (${unit})` : ""}
      </span>
      <input dir="ltr" inputMode="decimal" type="number" step={step} value={Number.isFinite(value) ? value : 0} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="stepper">
      <span>{label}</span>
      <div>
        <button type="button" onClick={() => onChange(Math.max(min, value - 1))} aria-label={`${label} کمتر`}>
          −
        </button>
        <b>{value}</b>
        <button type="button" onClick={() => onChange(Math.min(max, value + 1))} aria-label={`${label} بیشتر`}>
          +
        </button>
      </div>
    </div>
  );
}

function SectionField({
  label,
  value,
  families,
  onChange,
}: {
  label: string;
  value: string;
  families: Section["family"][];
  onChange: (id: string) => void;
}) {
  const list = sectionsOf(families);
  const extra = SECTIONS.find((s) => s.id === value && !list.some((x) => x.id === s.id));
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {extra && <option value={extra.id}>{extra.id}</option>}
        {families.map((f) => (
          <optgroup key={f} label={f}>
            {list
              .filter((s) => s.family === f)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id} · {Math.round(s.weight)} kg/m
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
