// ================= Mid-level resume =================
// Snapshots are taken at each WAVE CLEAR only (not per-frame, not mid-wave) — enemies in
// flight are never serialized. This keeps the format small and simple: resuming always
// drops the player back into the intermission right before the next wave, exactly as if
// they'd just cleared the saved one themselves.
export const RESUME_VERSION = 4;

export interface ResumeTower {
  specId: string;
  cell: number;
  stage: number;
  branch: number;
  branchStage: number;
  mode: string;
  spent: number;
  dmgDealt: number;
  kills: number;
  creditsEarned: number;
  vein: boolean;
  perk: string | null;   // Veterancy (Phase 4.6) — added in v2
}

export interface ResumeSnapshot {
  v: number;
  levelId: number;
  endless: boolean;
  daily: { dateStr: string; levelId: number; modifiers: string[]; mutatorBonus: number; difficulty: number } | null;
  tileSize: number;
  meander: number;
  diffTier: number;
  ascTier: number;
  mods: string[];        // the resolved active-modifier set at construction time (endless's one-time roll, etc.)
  waveIdx: number;
  credits: number;
  lives: number;
  novaCharge: number;
  novaNeed: number;
  cdOrbital: number;
  cdStasis: number;
  towers: ResumeTower[];
  leakLedger: Record<string, number>;   // Leak ledger (Phase 6.3) — added in v3
  draft: string[] | null;      // Drafted tower ids, or null for full-arsenal (Phase 8) — added in v4
  doctrine: string | null;     // Active doctrine at construction time (Phase 8) — added in v4
  savedAt: number;        // Date.now(), for display ("saved 2 hours ago") and as a tiebreaker
}

// Serialize — returns null if anything looks inconsistent (never throws).
export function serializeResume(g: {
  level: { id: number }; endless: boolean; tileSize?: number; cell: number; meander: number; diffTier: number;
  ascTier: number; mods: Set<string>; waveIdx: number; credits: number; lives: number; novaCharge: number;
  novaNeed: number; cds: Record<string, number>; leakLedger: Record<string, number>;
  draft: string[] | null; doctrine: string | null;
  towers: { spec: { id: string }; cell: number; stage: number; branch: number; branchStage: number; mode: string; spent: number; dmgDealt: number; kills: number; creditsEarned: number; vein: boolean; perk: string | null }[];
}, daily: ResumeSnapshot['daily']): string | null {
  try {
    const snap: ResumeSnapshot = {
      v: RESUME_VERSION,
      levelId: g.level.id,
      endless: g.endless,
      daily,
      tileSize: g.cell,
      meander: g.meander,
      diffTier: g.diffTier,
      ascTier: g.ascTier,
      mods: [...g.mods],
      waveIdx: g.waveIdx,
      credits: g.credits,
      lives: g.lives,
      novaCharge: g.novaCharge,
      novaNeed: g.novaNeed,
      cdOrbital: g.cds.orbital || 0,
      cdStasis: g.cds.stasis || 0,
      leakLedger: { ...g.leakLedger },
      draft: g.draft ? [...g.draft] : null,
      doctrine: g.doctrine,
      towers: g.towers.map(t => ({
        specId: t.spec.id, cell: t.cell, stage: t.stage, branch: t.branch, branchStage: t.branchStage,
        mode: t.mode, spent: t.spent, dmgDealt: t.dmgDealt, kills: t.kills, creditsEarned: t.creditsEarned, vein: t.vein,
        perk: t.perk,
      })),
      savedAt: Date.now(),
    };
    return JSON.stringify(snap);
  } catch {
    return null;
  }
}

// Deserialize — returns null on any version mismatch or malformed data (graceful discard,
// never throws, never crashes the app on a corrupted/old-format snapshot).
export function deserializeResume(raw: string | undefined): ResumeSnapshot | null {
  if (!raw) return null;
  try {
    const snap = JSON.parse(raw);
    if (!snap || typeof snap !== 'object' || snap.v !== RESUME_VERSION) return null;
    if (typeof snap.levelId !== 'number' || !Array.isArray(snap.towers)) return null;
    return snap as ResumeSnapshot;
  } catch {
    return null;
  }
}
