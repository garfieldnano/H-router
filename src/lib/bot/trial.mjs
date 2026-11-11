// Trial eligibility — pure once-per-user guard.
// A trial may be claimed ONCE per Telegram user AND once per member.
// The DB enforces it too (trialClaims.telegramId UNIQUE), this is the
// check the bot + API run before attempting the claim.

export function trialEligibility({ telegramClaim, memberClaim, trialPackage }) {
  if (!trialPackage) {
    return { ok: false, reason: "no_trial_package", message: "Paket trial belum tersedia. Hubungi owner." };
  }
  if (telegramClaim) {
    return {
      ok: false, reason: "already_claimed",
      message: `Kamu sudah pernah klaim trial (${new Date(telegramClaim.claimedAt).toLocaleDateString("id-ID")}). Trial hanya sekali per pengguna — silakan beli paket berbayar.`,
    };
  }
  if (memberClaim) {
    return {
      ok: false, reason: "already_claimed_member",
      message: "Akun member ini sudah pernah klaim trial. Trial hanya sekali per pengguna — silakan beli paket berbayar.",
    };
  }
  return { ok: true, reason: null, message: null };
}

export function trialDurationDays(trialPackage) {
  return trialPackage?.durationDays || 1;
}
