// Skill-level table — docs/research/doom-design.md §7.
import type { SkillDef, SkillId } from '../core';

export const SKILLS: Record<SkillId, SkillDef> = {
  1: { id: 1, name: "I'm Too Young To Die", monsterFlag: 'easy', damageTaken: 0.5, ammoMultiplier: 2, fastMonsters: false, respawn: false },
  2: { id: 2, name: 'Hey Not Too Rough', monsterFlag: 'easy', damageTaken: 1, ammoMultiplier: 1, fastMonsters: false, respawn: false },
  3: { id: 3, name: 'Hurt Me Plenty', monsterFlag: 'normal', damageTaken: 1, ammoMultiplier: 1, fastMonsters: false, respawn: false },
  4: { id: 4, name: 'Ultra-Violence', monsterFlag: 'hard', damageTaken: 1, ammoMultiplier: 1, fastMonsters: false, respawn: false },
  5: { id: 5, name: 'Nightmare!', monsterFlag: 'hard', damageTaken: 1, ammoMultiplier: 2, fastMonsters: true, respawn: true },
};

export const DEFAULT_SKILL: SkillId = 3;
