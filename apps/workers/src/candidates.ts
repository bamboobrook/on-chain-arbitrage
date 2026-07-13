import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface CandidateArtifact {
  generatedAt: string;
  candidates: Array<{
    id: string;
    chain: string;
    project: string;
    symbol: string;
    classification: string;
    isPureArbitrage: boolean;
    apyBase: number | null;
    apyBase7d: number | null;
    apyMean30d: number | null;
    tvlUsd: number | null;
    riskNotes: string[];
    source: string;
    liveInterfaceStatus: string;
  }>;
}

export async function loadCandidateArtifact(): Promise<CandidateArtifact | null> {
  try {
    const raw = await readFile(resolve(process.cwd(), 'data/strategy-candidates.json'), 'utf8');
    return JSON.parse(raw) as CandidateArtifact;
  } catch {
    return null;
  }
}

export function conservativeObservedApy(candidate: CandidateArtifact['candidates'][number]): number {
  const vals = [candidate.apyBase, candidate.apyBase7d, candidate.apyMean30d].filter(
    (x): x is number => typeof x === 'number' && Number.isFinite(x),
  );
  if (!vals.length) return 0;
  return Math.max(0, Math.min(...vals));
}
