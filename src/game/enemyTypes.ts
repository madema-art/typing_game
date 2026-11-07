export type EnemyKind = 'scout' | 'fighter' | 'heavy';

export interface EnemyDef {
  kind: EnemyKind;
  /** Seconds to descend from the top to the shield at difficulty 1.0. */
  travelTime: number;
  /** Base integrity damage when it reaches the shield. */
  damage: number;
  basePoints: number;
  /** Visual radius in px at k=1. */
  radius: number;
  color: string;
  accent: string;
  /** Lateral weave amplitude (px) and frequency (rad/s). */
  weaveAmp: number;
  weaveFreq: number;
  /** Progress pushed back per laser hit (fragile ships get knocked back more). */
  knockback: number;
}

export const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
  scout: {
    kind: 'scout',
    travelTime: 10.5,
    damage: 1,
    basePoints: 100,
    radius: 15,
    color: '#ffb547',
    accent: '#fff1c2',
    weaveAmp: 16,
    weaveFreq: 2.2,
    knockback: 0.006,
  },
  fighter: {
    kind: 'fighter',
    travelTime: 14.5,
    damage: 2,
    basePoints: 160,
    radius: 21,
    color: '#ff4fa3',
    accent: '#ffd0e8',
    weaveAmp: 5,
    weaveFreq: 0.9,
    knockback: 0.004,
  },
  heavy: {
    kind: 'heavy',
    travelTime: 23,
    damage: 3,
    basePoints: 320,
    radius: 32,
    color: '#a46bff',
    accent: '#ffd36b',
    weaveAmp: 0,
    weaveFreq: 0,
    knockback: 0.0015,
  },
};
