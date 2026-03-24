import { runtimeConfig } from "./runtime";

export const DAILY_REWARD_COINS = [5, 7, 10, 15, 20, 30, 50] as const;

export const DAILY_SCORE_CAP = 30;
export const DAILY_LEVELS_MAX = 30;
export const INITIAL_DAILY_UNLOCKED_LEVELS = Math.min(10, DAILY_LEVELS_MAX);
export const UNLOCK_INTERVAL_SECONDS = 3600;
export const UNLOCK_LEVELS_PER_INTERVAL = 1;
export const AD_UNLOCK_LEVELS = 2;
export const LEVEL_UNLOCK_MC_COST = 25;
export const DAILY_SURPRISE_BOX_MAX = 4;
export const SURPRISE_BOX_DAILY_MAX = DAILY_SURPRISE_BOX_MAX;
export const SURPRISE_BOX_COINS_REWARD = 15;

function validateLevelAccessConfig() {
  if (INITIAL_DAILY_UNLOCKED_LEVELS > DAILY_LEVELS_MAX) {
    throw new Error("invalid_level_access_config: INITIAL_DAILY_UNLOCKED_LEVELS must be <= DAILY_LEVELS_MAX");
  }
  if (UNLOCK_LEVELS_PER_INTERVAL <= 0) {
    throw new Error("invalid_level_access_config: UNLOCK_LEVELS_PER_INTERVAL must be > 0");
  }
  if (UNLOCK_INTERVAL_SECONDS < 300) {
    throw new Error("invalid_level_access_config: UNLOCK_INTERVAL_SECONDS must be >= 300");
  }
  if (AD_UNLOCK_LEVELS <= 0) {
    throw new Error("invalid_level_access_config: AD_UNLOCK_LEVELS must be > 0");
  }
  if (DAILY_LEVELS_MAX > 100) {
    throw new Error("invalid_level_access_config: DAILY_LEVELS_MAX must be <= 100");
  }
}

validateLevelAccessConfig();

export const DAILY_LEVELS_INITIAL_UNLOCKED = INITIAL_DAILY_UNLOCKED_LEVELS;
export const DAILY_LEVEL_UNLOCK_BATCH_SIZE = UNLOCK_LEVELS_PER_INTERVAL;
export const DAILY_LEVEL_UNLOCK_INTERVAL_HOURS = UNLOCK_INTERVAL_SECONDS / 3600;
export const DAILY_LEVEL_AD_UNLOCK_SIZE = AD_UNLOCK_LEVELS;

export const FREE_RESTARTS_PER_ACCOUNT = 3;
export const FREE_SKIPS_PER_ACCOUNT = 3;
export const FREE_HINTS_PER_ACCOUNT = 3;

export const RESTART_MC_COST = 15;
export const SKIP_MC_COST = 40;
export const HINT_MC_COST = 15;

export const LEGACY_RESTART_COST_COINS = 50;
export const LEGACY_SKIP_COST_COINS = 50;
export const LEGACY_HINT_COST_COINS = 50;

export const LEVEL_MC_REWARD = 2;
export const LEVEL_RP_HINT_REWARD = 1;
export const LEVEL_RP_CLEAN_REWARD = 2;
export const LEVEL_RP_SKIP_REWARD = 0;

export const AD_MC_REWARD_BASE = 50;
export const AD_MC_REWARD_SOFT_CAP_START = 10;
export const AD_MC_REWARD_DECAY = 5;
export const AD_MC_REWARD_MIN = 5;

export const MYSTERY_CHEST_REWARD_TABLE = [
  { upto: 0.4, coins: 50 },
  { upto: 0.7, coins: 100 },
  { upto: 0.9, coins: 150 },
  { upto: 1, coins: 200 },
] as const;

export type SurpriseBoxReward =
  | { rewardType: "coins"; rewardAmount: number; coins: number }
  | { rewardType: "restart"; rewardAmount: number; restartCount: number }
  | { rewardType: "hint"; rewardAmount: number; hintCount: number }
  | { rewardType: "skip"; rewardAmount: number; skipCount: number };

export const MONTHLY_PI_POOL = runtimeConfig.economy.monthlyPiPool;

export const REWARD_TIERS = [
  { name: "A", label: "Champion", percent: 1, poolShare: 40 },
  { name: "B", label: "Elite", percent: 4, poolShare: 27 },
  { name: "C", label: "Advanced", percent: 15, poolShare: 20 },
  { name: "D", label: "Qualified", percent: 30, poolShare: 13 },
] as const;

export type RewardTierName = (typeof REWARD_TIERS)[number]["name"];

export const MONTHLY_ELIGIBILITY_MIN_SCORE = 150;
export const MONTHLY_ELIGIBILITY_MIN_UNIQUE_LEVELS = 10;

export const DAILY_RANKING_REWARD_TABLE: Record<number, number> = {
  1: 120,
  2: 100,
  3: 80,
  4: 60,
  5: 50,
  6: 40,
  7: 35,
  8: 30,
  9: 25,
  10: 20,
};

export function getDailyRewardCoinsForDay(day: number) {
  return DAILY_REWARD_COINS[Math.max(0, Math.min(DAILY_REWARD_COINS.length - 1, day - 1))];
}

export function getAdRewardCoinsForDailyCount(adsWatchedToday: number) {
  if (adsWatchedToday < AD_MC_REWARD_SOFT_CAP_START) {
    return AD_MC_REWARD_BASE;
  }

  const extra = adsWatchedToday - AD_MC_REWARD_SOFT_CAP_START;
  const reward = AD_MC_REWARD_BASE - (extra * AD_MC_REWARD_DECAY);
  return Math.max(reward, AD_MC_REWARD_MIN);
}

export function getMysteryChestRewardFromRoll(randomValue: number) {
  const roll = Number.isFinite(randomValue) ? randomValue : Math.random();
  const row = MYSTERY_CHEST_REWARD_TABLE.find((entry) => roll < entry.upto) || MYSTERY_CHEST_REWARD_TABLE[MYSTERY_CHEST_REWARD_TABLE.length - 1];
  return row.coins;
}

export function rollSurpriseBoxReward(randomValue = Math.random()): SurpriseBoxReward {
  const roll = Number.isFinite(randomValue) ? randomValue : Math.random();

  if (roll < 0.3) {
    return { rewardType: "coins", rewardAmount: SURPRISE_BOX_COINS_REWARD, coins: SURPRISE_BOX_COINS_REWARD };
  }
  if (roll < 0.6) {
    return { rewardType: "restart", rewardAmount: 1, restartCount: 1 };
  }
  if (roll < 0.9) {
    return { rewardType: "hint", rewardAmount: 1, hintCount: 1 };
  }
  return { rewardType: "skip", rewardAmount: 1, skipCount: 1 };
}
