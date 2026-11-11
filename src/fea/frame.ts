import { sectionById, sectionsOf, type Section } from "./sections.ts";

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
