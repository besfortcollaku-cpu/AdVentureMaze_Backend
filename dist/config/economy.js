"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DAILY_RANKING_REWARD_TABLE = exports.MONTHLY_ELIGIBILITY_MIN_UNIQUE_LEVELS = exports.MONTHLY_ELIGIBILITY_MIN_SCORE = exports.REWARD_TIERS = exports.MONTHLY_PI_POOL = exports.MYSTERY_CHEST_REWARD_TABLE = exports.AD_MC_REWARD_MIN = exports.AD_MC_REWARD_DECAY = exports.AD_MC_REWARD_SOFT_CAP_START = exports.AD_MC_REWARD_BASE = exports.LEVEL_RP_SKIP_REWARD = exports.LEVEL_RP_CLEAN_REWARD = exports.LEVEL_RP_HINT_REWARD = exports.LEVEL_MC_REWARD = exports.LEGACY_HINT_COST_COINS = exports.LEGACY_SKIP_COST_COINS = exports.LEGACY_RESTART_COST_COINS = exports.HINT_MC_COST = exports.SKIP_MC_COST = exports.RESTART_MC_COST = exports.FREE_HINTS_PER_ACCOUNT = exports.FREE_SKIPS_PER_ACCOUNT = exports.FREE_RESTARTS_PER_ACCOUNT = exports.DAILY_LEVEL_AD_UNLOCK_SIZE = exports.DAILY_LEVEL_UNLOCK_INTERVAL_HOURS = exports.DAILY_LEVEL_UNLOCK_BATCH_SIZE = exports.DAILY_LEVELS_INITIAL_UNLOCKED = exports.SURPRISE_BOX_COINS_REWARD = exports.SURPRISE_BOX_DAILY_MAX = exports.DAILY_SURPRISE_BOX_MAX = exports.LEVEL_UNLOCK_MC_COST = exports.AD_UNLOCK_LEVELS = exports.UNLOCK_LEVELS_PER_INTERVAL = exports.UNLOCK_INTERVAL_SECONDS = exports.INITIAL_DAILY_UNLOCKED_LEVELS = exports.DAILY_LEVELS_MAX = exports.DAILY_SCORE_CAP = exports.DAILY_REWARD_COINS = void 0;
exports.getDailyRewardCoinsForDay = getDailyRewardCoinsForDay;
exports.getAdRewardCoinsForDailyCount = getAdRewardCoinsForDailyCount;
exports.getMysteryChestRewardFromRoll = getMysteryChestRewardFromRoll;
exports.rollSurpriseBoxReward = rollSurpriseBoxReward;
const runtime_1 = require("./runtime");
exports.DAILY_REWARD_COINS = [5, 7, 10, 15, 20, 30, 50];
exports.DAILY_SCORE_CAP = 30;
exports.DAILY_LEVELS_MAX = 30;
exports.INITIAL_DAILY_UNLOCKED_LEVELS = Math.min(10, exports.DAILY_LEVELS_MAX);
exports.UNLOCK_INTERVAL_SECONDS = 3600;
exports.UNLOCK_LEVELS_PER_INTERVAL = 1;
exports.AD_UNLOCK_LEVELS = 2;
exports.LEVEL_UNLOCK_MC_COST = 25;
exports.DAILY_SURPRISE_BOX_MAX = 4;
exports.SURPRISE_BOX_DAILY_MAX = exports.DAILY_SURPRISE_BOX_MAX;
exports.SURPRISE_BOX_COINS_REWARD = 15;
function validateLevelAccessConfig() {
    if (exports.INITIAL_DAILY_UNLOCKED_LEVELS > exports.DAILY_LEVELS_MAX) {
        throw new Error("invalid_level_access_config: INITIAL_DAILY_UNLOCKED_LEVELS must be <= DAILY_LEVELS_MAX");
    }
    if (exports.UNLOCK_LEVELS_PER_INTERVAL <= 0) {
        throw new Error("invalid_level_access_config: UNLOCK_LEVELS_PER_INTERVAL must be > 0");
    }
    if (exports.UNLOCK_INTERVAL_SECONDS < 300) {
        throw new Error("invalid_level_access_config: UNLOCK_INTERVAL_SECONDS must be >= 300");
    }
    if (exports.AD_UNLOCK_LEVELS <= 0) {
        throw new Error("invalid_level_access_config: AD_UNLOCK_LEVELS must be > 0");
    }
    if (exports.DAILY_LEVELS_MAX > 100) {
        throw new Error("invalid_level_access_config: DAILY_LEVELS_MAX must be <= 100");
    }
}
validateLevelAccessConfig();
exports.DAILY_LEVELS_INITIAL_UNLOCKED = exports.INITIAL_DAILY_UNLOCKED_LEVELS;
exports.DAILY_LEVEL_UNLOCK_BATCH_SIZE = exports.UNLOCK_LEVELS_PER_INTERVAL;
exports.DAILY_LEVEL_UNLOCK_INTERVAL_HOURS = exports.UNLOCK_INTERVAL_SECONDS / 3600;
exports.DAILY_LEVEL_AD_UNLOCK_SIZE = exports.AD_UNLOCK_LEVELS;
exports.FREE_RESTARTS_PER_ACCOUNT = 3;
exports.FREE_SKIPS_PER_ACCOUNT = 3;
exports.FREE_HINTS_PER_ACCOUNT = 3;
exports.RESTART_MC_COST = 15;
exports.SKIP_MC_COST = 40;
exports.HINT_MC_COST = 15;
exports.LEGACY_RESTART_COST_COINS = 50;
exports.LEGACY_SKIP_COST_COINS = 50;
exports.LEGACY_HINT_COST_COINS = 50;
exports.LEVEL_MC_REWARD = 1;
exports.LEVEL_RP_HINT_REWARD = 0;
exports.LEVEL_RP_CLEAN_REWARD = 2;
exports.LEVEL_RP_SKIP_REWARD = 0;
exports.AD_MC_REWARD_BASE = 50;
exports.AD_MC_REWARD_SOFT_CAP_START = 10;
exports.AD_MC_REWARD_DECAY = 5;
exports.AD_MC_REWARD_MIN = 5;
exports.MYSTERY_CHEST_REWARD_TABLE = [
    { upto: 0.4, coins: 50 },
    { upto: 0.7, coins: 100 },
    { upto: 0.9, coins: 150 },
    { upto: 1, coins: 200 },
];
exports.MONTHLY_PI_POOL = runtime_1.runtimeConfig.economy.monthlyPiPool;
exports.REWARD_TIERS = [
    { name: "A", label: "Champion", percent: 1, poolShare: 40 },
    { name: "B", label: "Elite", percent: 4, poolShare: 27 },
    { name: "C", label: "Advanced", percent: 15, poolShare: 20 },
    { name: "D", label: "Qualified", percent: 30, poolShare: 13 },
];
exports.MONTHLY_ELIGIBILITY_MIN_SCORE = 150;
exports.MONTHLY_ELIGIBILITY_MIN_UNIQUE_LEVELS = 10;
exports.DAILY_RANKING_REWARD_TABLE = {
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
function getDailyRewardCoinsForDay(day) {
    return exports.DAILY_REWARD_COINS[Math.max(0, Math.min(exports.DAILY_REWARD_COINS.length - 1, day - 1))];
}
function getAdRewardCoinsForDailyCount(adsWatchedToday) {
    if (adsWatchedToday < exports.AD_MC_REWARD_SOFT_CAP_START) {
        return exports.AD_MC_REWARD_BASE;
    }
    const extra = adsWatchedToday - exports.AD_MC_REWARD_SOFT_CAP_START;
    const reward = exports.AD_MC_REWARD_BASE - (extra * exports.AD_MC_REWARD_DECAY);
    return Math.max(reward, exports.AD_MC_REWARD_MIN);
}
function getMysteryChestRewardFromRoll(randomValue) {
    const roll = Number.isFinite(randomValue) ? randomValue : Math.random();
    const row = exports.MYSTERY_CHEST_REWARD_TABLE.find((entry) => roll < entry.upto) || exports.MYSTERY_CHEST_REWARD_TABLE[exports.MYSTERY_CHEST_REWARD_TABLE.length - 1];
    return row.coins;
}
function rollSurpriseBoxReward(randomValue = Math.random()) {
    const roll = Number.isFinite(randomValue) ? randomValue : Math.random();
    if (roll < 0.3) {
        return { rewardType: "coins", rewardAmount: exports.SURPRISE_BOX_COINS_REWARD, coins: exports.SURPRISE_BOX_COINS_REWARD };
    }
    if (roll < 0.6) {
        return { rewardType: "restart", rewardAmount: 1, restartCount: 1 };
    }
    if (roll < 0.9) {
        return { rewardType: "hint", rewardAmount: 1, hintCount: 1 };
    }
    return { rewardType: "skip", rewardAmount: 1, skipCount: 1 };
}
