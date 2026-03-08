export function createDailyRewardPopup() {
  const el = document.createElement("div");
  el.className = "daily-reward-overlay hidden";

  el.innerHTML = `
    <div class="daily-reward-box">
      <div class="daily-reward-title">Daily Reward</div>
      <div class="daily-reward-subtitle">Come back every day to keep your streak.</div>

      <div id="dailyRewardGrid" class="daily-reward-grid"></div>

      <div class="daily-reward-claim-wrap">
        <div class="daily-reward-coins">
          +<b id="dailyRewardCoins">5</b> coins
        </div>

        <button id="dailyRewardClaimBtn" class="daily-reward-btn">
          Claim
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(el);

  const gridEl = el.querySelector("#dailyRewardGrid");
  const coinsEl = el.querySelector("#dailyRewardCoins");
  const claimBtn = el.querySelector("#dailyRewardClaimBtn");

  let claimHandler = null;

  const REWARDS = [5, 7, 10, 15, 20, 30, 50];

  function renderDays(activeDay = 1) {
    gridEl.innerHTML = "";

    REWARDS.forEach((coins, i) => {
      const day = i + 1;
      const item = document.createElement("div");
      item.className = "daily-reward-day";

      if (day === activeDay) {
        item.classList.add("active");
      }

      item.innerHTML = `
        <div class="daily-reward-day-label">Day ${day}</div>
        <div class="daily-reward-day-coins">${coins}</div>
      `;

      gridEl.appendChild(item);
    });
  }

  claimBtn.addEventListener("click", async () => {
    if (claimBtn.disabled) return;
    claimBtn.disabled = true;

    try {
      await claimHandler?.();
    } finally {
      claimBtn.disabled = false;
    }
  });

  return {
    show({ day = 1, coins = 5 } = {}) {
      renderDays(day);
      coinsEl.textContent = String(coins);
      el.classList.remove("hidden");
    },

    hide() {
      el.classList.add("hidden");
    },

    onClaim(fn) {
      claimHandler = fn;
    },
  };
}