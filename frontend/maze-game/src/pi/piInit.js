export function initPi() {
  if (!window.Pi) {
    console.warn("Pi SDK not found");
    return;
  }

  try {
    window.Pi.init({
      version: "2.0",
      sandbox: true // ⚠️ set FALSE only after Mainnet approval
    });

    console.log("✅ Pi SDK initialized");
  } catch (e) {
    console.error("❌ Pi init failed", e);
  }
}