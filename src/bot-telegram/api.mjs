// HTTP client for the server's internal bot API (/api/bot/*).
// Auth: shared service secret header (x-hrouter-bot-secret).
// NEVER logs request/response bodies — order confirm / trial responses
// contain full API keys.

export class BotApiError extends Error {
  constructor(status, message) {
    super(message || `Bot API error ${status}`);
    this.status = status;
  }
}

export class BotApiClient {
  constructor({ baseUrl, secret }) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.secret = secret;
  }

  async request(method, path, body) {
    const url = `${this.baseUrl}${path}`;
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: {
          "content-type": "application/json",
          "x-hrouter-bot-secret": this.secret,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new BotApiError(0, `Tidak bisa menghubungi server (${this.baseUrl}): ${e.message}`);
    }
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON body */ }
    if (!res.ok) {
      throw new BotApiError(res.status, data?.error || `Server mengembalikan ${res.status}`);
    }
    return data;
  }

  get(path) { return this.request("GET", path); }
  post(path, body = {}) { return this.request("POST", path, body); }
  put(path, body = {}) { return this.request("PUT", path, body); }
  del(path) { return this.request("DELETE", path); }

  // -- config / linking -------------------------------------------------
  getConfig() { return this.get("/api/bot/config"); }
  verifyLinkCode(payload) { return this.post("/api/bot/link/verify", payload); }
  linkChat(payload) { return this.post("/api/bot/link/chat", payload); }
  resolveMember(telegramId) { return this.get(`/api/bot/member/by-telegram?telegramId=${encodeURIComponent(telegramId)}`); }

  // -- member -----------------------------------------------------------
  getMemberUsage(memberId, period = "today") { return this.get(`/api/bot/member/${memberId}/usage?period=${encodeURIComponent(period)}`); }
  getMemberDaily(memberId) { return this.get(`/api/bot/member/${memberId}/daily`); }
  getMemberKeys(memberId) { return this.get(`/api/bot/member/${memberId}/keys`); }
  // Transaction history (PRD §5.1 "TRANSACTION HISTORY"): the member's
  // own orders, newest first. The bot orders route supports memberId.
  listMemberOrders(memberId, limit = 10) { return this.get(`/api/bot/orders?memberId=${encodeURIComponent(memberId)}&limit=${limit}`); }
  // Model catalog (PRD §5.1 "AVAILABLE MODELS"): the public catalog —
  // same list the landing page shows (admin-published models only).
  // Public endpoint, no bot secret needed; the extra header is ignored.
  listPublicModels() { return this.get("/api/public/models"); }

  // -- shop -------------------------------------------------------------
  listPackages() { return this.get("/api/bot/packages"); }
  createOrder(payload) { return this.post("/api/bot/orders", payload); }
  uploadProof(orderId, fileId) { return this.post(`/api/bot/orders/${orderId}/proof`, { fileId }); }
  getOrder(orderId) { return this.get(`/api/bot/orders/${orderId}`); }
  claimTrial(payload) { return this.post("/api/bot/trial/claim", payload); }

  // -- admin ------------------------------------------------------------
  getOverview() { return this.get("/api/bot/admin/overview"); }
  listMembers() { return this.get("/api/bot/admin/members"); }
  toggleMember(memberId) { return this.post(`/api/bot/admin/members/${memberId}/toggle`); }
  listKeys() { return this.get("/api/bot/admin/keys"); }
  toggleKey(keyId) { return this.post(`/api/bot/admin/keys/${keyId}/toggle`); }
  setKeyRpm(keyId, rpmLimit) { return this.post(`/api/bot/admin/keys/${keyId}/rpm`, { rpmLimit }); }
  listAdminPackages() { return this.get("/api/bot/admin/packages"); }
  createAdminPackage(payload) { return this.post("/api/bot/admin/packages", payload); }
  updateAdminPackage(id, payload) { return this.put(`/api/bot/admin/packages/${id}`, payload); }
  deleteAdminPackage(id) { return this.del(`/api/bot/admin/packages/${id}`); }
  listPendingOrders() { return this.get("/api/bot/orders?status=pending_confirm&limit=20"); }
  confirmOrder(orderId, note) { return this.post(`/api/bot/orders/${orderId}/confirm`, { note }); }
  rejectOrder(orderId, note) { return this.post(`/api/bot/orders/${orderId}/reject`, { note }); }
  getAdminUsage(period = "today") { return this.get(`/api/bot/admin/usage?period=${encodeURIComponent(period)}`); }
  getAdminSettings() { return this.get("/api/bot/admin/settings"); }
  setGlobalRpm(defaultRpmLimit) { return this.post("/api/bot/admin/settings/rpm", { defaultRpmLimit }); }
  updatePayment(payload) { return this.post("/api/bot/admin/settings/payment", payload); }
  getDigest(date) { return this.get(date ? `/api/bot/admin/digest?date=${encodeURIComponent(date)}` : "/api/bot/admin/digest"); }
  sweepTrials() { return this.post("/api/bot/admin/sweep-trials"); }

  // -- incidents & compensation (plan §0d) --------------------------------
  recordProbe(payload) { return this.post("/api/bot/admin/incidents/probe", payload); }
  listIncidents(status) { return this.get(status ? `/api/bot/admin/incidents?status=${encodeURIComponent(status)}` : "/api/bot/admin/incidents"); }
  getIncident(incidentId) { return this.get(`/api/bot/admin/incidents/${incidentId}`); }
  grantCompensation(incidentId, payload) { return this.post(`/api/bot/admin/incidents/${incidentId}/grant`, payload); }
  listCompensations() { return this.get("/api/bot/admin/compensations"); }
  getMemberCompensations(memberId) { return this.get(`/api/bot/member/${memberId}/compensations`); }
}
