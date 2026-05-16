export interface AIConfig {
  skillLevel: number
  reactionTime: number
  accuracy: number
  aggressiveness: number
  dodgeChance: number
}

export const DEFAULT_AI_CONFIG: AIConfig = {
  skillLevel: 5,
  reactionTime: 150,
  accuracy: 0.7,
  aggressiveness: 0.5,
  dodgeChance: 0.5,
}

export const difficultyPresets: Record<string, AIConfig> = {
  easy: { skillLevel: 2, reactionTime: 400, accuracy: 0.2, aggressiveness: 0.2, dodgeChance: 0.1 },
  medium: { skillLevel: 5, reactionTime: 200, accuracy: 0.5, aggressiveness: 0.5, dodgeChance: 0.4 },
  hard: { skillLevel: 8, reactionTime: 80, accuracy: 0.8, aggressiveness: 0.8, dodgeChance: 0.7 },
  unfair: { skillLevel: 10, reactionTime: 30, accuracy: 1.0, aggressiveness: 1.0, dodgeChance: 1.0 },
}
