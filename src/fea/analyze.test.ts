import assert from "node:assert/strict";
import test from "node:test";
import { analyze, DEFAULT_INPUT, reflectionB, spectrumBN } from "./analyze.ts";
import { __test } from "./analyze.ts";
import { sectionById } from "./sections.ts";

const { localK, toGlobalK, applyR, equiv, cholesky, cholSolve } = __test;

function solveCase(opts: {
  L: number;
  Iy: number;
  Iz: number;
  A: number;
  J: number;
  load: number[];
  fixEnd?: boolean;
}) {
  const sec = {
    ...sectionById("IPE300"),
    A: opts.A,
    Iy: opts.Iy,
    Iz: opts.Iz,
    J: opts.J,
  };
  const L = opts.L;
  const kL = localK(sec, L, false);
  const R = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const Kg = toGlobalK(kL, R);
  const fixed = [true, true, true, true, true, true, false, false, false, opts.fixEnd ?? false, opts.fixEnd ?? false, opts.fixEnd ?? false];
  const idx = new Int32Array(12).fill(-1);
  let n = 0;
  for (let i = 0; i < 12; i++) if (!fixed[i]) idx[i] = n++;
  const K = new Float64Array(n * n);
  for (let i = 0; i < 12; i++) {
    if (idx[i] < 0) continue;
    for (let j = 0; j < 12; j++) {
      if (idx[j] < 0) continue;
      K[idx[i] * n + idx[j]] += Kg[i * 12 + j];
    }
  }
  const rhs = new Float64Array(n);
  for (let i = 0; i < 12; i++) if (idx[i] >= 0) rhs[idx[i]] = opts.load[i] ?? 0;
  const err = cholesky(K, n);
  assert.equal(err, null);
  const x = cholSolve(K, rhs, n);
  const d = new Float64Array(12);
  for (let i = 0; i < 12; i++) if (idx[i] >= 0) d[i] = x[idx[i]];
  const f = __test.mulK(kL, applyR(R, d, false));
  return { d, f };
}

test("cantilever tip load matches PL^3/3EI", () => {
  const L = 4;
  const I = 8e-5;
  const E = 2e8;
  const P = 10;
  const { d, f } = solveCase({
    L,
    Iy: I,
    Iz: I,
    A: 0.02,
    J: 1e-5,
    load: [0, 0, 0, 0, 0, 0, 0, 0, P, 0, 0, 0],
  });
  const expect = (P * L ** 3) / (3 * E * I);
  assert.ok(Math.abs(d[8] - expect) / expect < 1e-6, `dz ${d[8]} vs ${expect}`);
  assert.ok(Math.abs(Math.abs(f[4]) - P * L) / (P * L) < 1e-6, `M ${f[4]}`);
});

test("axial bar shortens by PL/EA", () => {
  const L = 3;
  const A = 0.01;
  const E = 2e8;
  const P = 100;
  const { d } = solveCase({
    L,
    Iy: 1e-4,
    Iz: 1e-4,
    A,
    J: 1e-5,
    load: [0, 0, 0, 0, 0, 0, -P, 0, 0, 0, 0, 0],
    fixEnd: true,
  });
  const expect = (P * L) / (E * A);
  assert.ok(Math.abs(-d[6] - expect) / expect < 1e-6, `dx ${d[6]} vs ${-expect}`);
});

test("fixed-end moment of a uniform load is wL^2/12", () => {
  const L = 6;
  const w = 10;
  const q = equiv(0, 0, -w, L, false);
  assert.ok(Math.abs(q[4] - (w * L * L) / 12) < 1e-9);
  assert.ok(Math.abs(q[2] + (w * L) / 2) < 1e-9);
});

test("building gravity closes vertical equilibrium", () => {
  const res = analyze({
    ...DEFAULT_INPUT,
    nx: 1,
    ny: 1,
    stories: 1,
    bayX: 6,
    bayY: 6,
    storyH: 3,
    qd: 1,
    ql: 0,
    selfWeight: false,
    psi: 0,
    C: 0.1,
    seismicMode: "coeff",
    pdelta: false,
  });
  assert.equal(res.unstable, null);
  assert.ok(Math.abs(res.verticalLoad - 36) < 0.05, `load ${res.verticalLoad}`);
  assert.ok(Math.abs(res.verticalReaction - res.verticalLoad) / 36 < 0.02, `R ${res.verticalReaction}`);
  assert.ok(Math.abs(res.seismic.V - 3.6) < 0.05, `V ${res.seismic.V}`);
  assert.ok(res.maxDisp > 0);
});

test("lateral drift grows with a softer frame", () => {
  const stiff = analyze({
    ...DEFAULT_INPUT,
    nx: 1,
    ny: 1,
    stories: 1,
    bayX: 6,
    bayY: 6,
    columnSection: "HEB400",
    beamXSection: "IPE600",
    beamYSection: "IPE600",
    selfWeight: false,
    qd: 4,
    ql: 0,
    seismicMode: "coeff",
    C: 0.2,
    pdelta: false,
  });
  const soft = analyze({
    ...stiff.input,
    columnSection: "HEB140",
    beamXSection: "IPE200",
    beamYSection: "IPE200",
  });
  assert.ok(soft.maxDisp > stiff.maxDisp);
});

test("soil II plateau of standard 2800 is S+1", () => {
  assert.ok(Math.abs(reflectionB(0.3, "II") - 2.5) < 1e-9);
  assert.ok(Math.abs(reflectionB(0.2, "I") - 2.5) < 1e-9);
  assert.ok(reflectionB(2, "II") < reflectionB(0.5, "II"));
  const at2 = spectrumBN(2, "II", 0.3);
  assert.ok(Math.abs(at2.B1 - 0.625) < 1e-9, `B1 ${at2.B1}`);
  assert.ok(Math.abs(at2.N - 1.3) < 1e-9, `N ${at2.N}`);
  assert.ok(Math.abs(reflectionB(0.5, "IV", 0.35) - 2.75) < 1e-9);
  assert.ok(Math.abs(reflectionB(0.5, "IV", 0.2) - 3.25) < 1e-9);
});

test("flexible low-hazard frame is held at 0.12 A I", () => {
  const res = analyze({
    ...DEFAULT_INPUT,
    stories: 6,
    storyH: 6,
    R: 12,
    A: 0.2,
    soil: "I",
    nx: 1,
    ny: 1,
  });
  assert.equal(res.unstable, null);
  assert.ok(Math.abs(res.seismic.C - 0.12 * 0.2) < 1e-6, `C ${res.seismic.C}`);
  assert.equal(res.codes.find((c) => c.id === "spectrum")?.detail.includes("کف"), true);
});

test("H1 flexure ratio tracks phiMn", () => {
  const sec = sectionById("IPE300");
  const Mn = __test.nominalStrong(sec, 240, 0, 1);
  const Mw = __test.nominalWeak(sec, 240);
  const phiMn = 0.9 * Mn;
  const half = __test.interact(sec, 6, 1, 240, 0, 0, phiMn * 0.5, 0, 0, phiMn, 0.9 * Mw);
  assert.ok(Math.abs(half.ratio - 0.5) < 0.03, `ratio ${half.ratio}`);
  const ax = __test.interact(sec, 3.2, 1.2, 240, 400, 0, 0, 0, 0, phiMn, 0.9 * Mw);
  assert.ok(ax.ratio > 0 && ax.ratio < 2, `axial ${ax.ratio}`);
  assert.equal(ax.equation.startsWith("H1"), true);
});

test("Cb stays inside 1 to 3 and pure compression uses H1-1a", () => {
  assert.equal(__test.cbFactor([10, 10, 10, 10, 10]), 1);
  const cb = __test.cbFactor([0, 5, 10, 5, 0]);
  assert.ok(cb > 1 && cb <= 3, `cb ${cb}`);
  assert.ok(__test.b1Factor(1, 0, 1000) === 1);
  assert.ok(__test.b1Factor(1, 100, 1000) > 1);
});

test("code building stays solvable with rigid diaphragm and reports period", () => {
  const res = analyze(DEFAULT_INPUT);
  assert.equal(res.unstable, null);
  assert.ok(res.memberResults.length > 10);
  assert.ok(res.seismic.Ta > 0);
  assert.ok(res.seismic.Tray > 0);
  assert.ok(res.seismic.T <= res.seismic.Ta * 1.25 + 1e-6);
  assert.ok(res.stories.every((s) => s.thetaMax <= 0.25));
  assert.ok(res.memberResults.every((m) => m.checks.length === 4 && Number.isFinite(m.ratio)));
  const ids = res.codes.map((c) => c.id);
  for (const id of ["combo", "orth", "drift", "theta", "h1", "defl", "compact", "scwb"]) assert.ok(ids.includes(id), id);
  assert.equal(res.codes.find((c) => c.id === "drift")?.status, res.maxDrift <= 1 ? "pass" : "fail");
  assert.equal(res.codes.find((c) => c.id === "ev")?.detail.includes("اعمال نشده"), true);
});

test("fixed-end beam deflection is wL^4/384EI", () => {
  const L = 6;
  const w = 12;
  const I = 8e-5;
  const E = 2e8;
  const My = (w * L * L) / 12;
  const d = __test.beamRelDeflection(L, -w, My, My, I);
  const expect = (w * L ** 4) / (384 * E * I);
  assert.ok(Math.abs(d - expect) / expect < 1e-6, `${d} vs ${expect}`);
});

test("very high hazard adds the vertical seismic component", () => {
  const res = analyze({ ...DEFAULT_INPUT, A: 0.35, nx: 1, ny: 1, stories: 1 });
  assert.equal(res.unstable, null);
  assert.equal(res.codes.find((c) => c.id === "ev")?.detail.includes("Ev="), true);
});
