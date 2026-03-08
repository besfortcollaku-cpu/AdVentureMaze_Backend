// src/ui/uiAccount.js
import "../css/account.css";

export function mountAccountUI(root) {
  // Inject overlay HTML once
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="accountOverlay" id="accountOverlay" aria-hidden="true">
<div class="accountCard full">
  <div class="accountTopBar">
    <div class="accountTopLeft">
<div class="accountTopNameWrap">
  <span id="accountUsername">guest</span>
  <button id="accountEditName" class="accountEditBtn">✎</button>
</div>      <div class="accountTopCoins">
        🪙 <span id="accountCoins">0</span>
      </div>
    </div>

    <button class="accountClose" id="accountCloseBtn">✕</button>
  </div>

  <div class="accountScroll">
    <div class="accountContent">



      <!-- FUTURE CONTENT WILL GO HERE -->
      <div class="accountSection">
  <h3>Player Stats</h3>

  <div class="accountRow">
    <span>Level</span>
    <span id="accountLevels">0</span>
  </div>

  <div class="accountRow">
    <span>Free Skips Used</span>
    <span id="accountSkipsUsed">0</span>
  </div>

  <div class="accountRow">
    <span>Free Hints Used</span>
    <span id="accountHintsUsed">0</span>
  </div>

  <div class="accountRow">
    <span>Free Restarts Used</span>
    <span id="accountRestartsUsed">0</span>
  </div>
</div>

<div class="accountSection" id="inviteSection">
  <h3>Invite Friends</h3>

  <div class="accountInviteBox">
    <input id="accountInviteLink" readonly />
    <button id="accountCopyInvite">Copy</button>
  </div>

  <div class="accountRow">
    <span>Valid Invites</span>
    <span id="accountInviteCount">0</span>
  </div>
</div>

    </div>
  </div>
</div>
    </div>
  `;
  root.appendChild(wrap);

  const overlay = root.querySelector("#accountOverlay");
  const closeBtn = root.querySelector("#accountCloseBtn");

  const usernameEl = root.querySelector("#accountUsername");
  
  const coinsEl = root.querySelector("#accountCoins");
 const levelsEl = root.querySelector("#accountLevels");
const skipsUsedEl = root.querySelector("#accountSkipsUsed");
const hintsUsedEl = root.querySelector("#accountHintsUsed");
const restartsUsedEl = root.querySelector("#accountRestartsUsed");
const inviteLinkEl = root.querySelector("#accountInviteLink");
const inviteCountEl = root.querySelector("#accountInviteCount");
const copyInviteBtn = root.querySelector("#accountCopyInvite");
const inviteSection = root.querySelector("#inviteSection");

const editBtn = root.querySelector("#accountEditName");
let isEditing = false;


  function show() {
    if (!overlay) return;
    overlay.classList.add("show");
    overlay.setAttribute("aria-hidden", "false");
  }

  function hide() {
    if (!overlay) return;
    overlay.classList.remove("show");
    overlay.setAttribute("aria-hidden", "true");
  }

  function setUser(user) {
  if (!user) return;

  const name = user.username ?? "guest";
  if (usernameEl) usernameEl.textContent = name;

  if (levelsEl) levelsEl.textContent = String(user.level ?? 0);
  if (skipsUsedEl) skipsUsedEl.textContent = String(user.free_skips_used ?? 0);
  if (hintsUsedEl) hintsUsedEl.textContent = String(user.free_hints_used ?? 0);
  if (restartsUsedEl) restartsUsedEl.textContent = String(user.free_restarts_used ?? 0);

  if (inviteCountEl) {
    inviteCountEl.textContent = String(user.invited_count ?? 0);
  }

  if (inviteLinkEl && user.uid) {
    inviteLinkEl.value = `${window.location.origin}?ref=${user.uid}`;
  }

  if (inviteSection) {
    inviteSection.style.display = user.uid ? "block" : "none";
  }
}

copyInviteBtn?.addEventListener("click", async () => {
  if (!inviteLinkEl?.value) return;

  try {
    await navigator.clipboard.writeText(inviteLinkEl.value);
    copyInviteBtn.textContent = "Copied ✓";
    setTimeout(() => {
      copyInviteBtn.textContent = "Copy";
    }, 1500);
  } catch {}
});
  function setCoins(n) {
    if (coinsEl) coinsEl.textContent = String(n ?? 0);
  }
  closeBtn?.addEventListener("click", hide);
  overlay?.addEventListener("click", (e) => {
    if (e.target === overlay) hide();
  });

  return { show, hide, setUser, setCoins };
}