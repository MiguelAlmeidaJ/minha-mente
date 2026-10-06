const GoogleCalendar = (() => {
  const API_BASE = "https://www.googleapis.com/calendar/v3";
  const SCOPES = ["https://www.googleapis.com/auth/calendar.events"];
  const PLACEHOLDER = "SUBSTITUA_PELO_CLIENT_ID.apps.googleusercontent.com";

  function isConfigured() {
    const manifest = chrome.runtime.getManifest();
    const clientId = manifest.oauth2?.client_id || "";
    return Boolean(clientId && clientId !== PLACEHOLDER && !clientId.startsWith("SUBSTITUA_"));
  }

  async function getToken(interactive = false) {
    if (!isConfigured()) {
      throw new Error("OAuth ainda não configurado. Adicione o Client ID no manifest.json.");
    }

    const result = await chrome.identity.getAuthToken({
      interactive,
      scopes: SCOPES,
      enableGranularPermissions: true
    });

    const token = typeof result === "string" ? result : result?.token;
    if (!token) throw new Error("Não foi possível obter o token do Google.");
    return token;
  }

  async function clearToken(token) {
    if (!token) return;
    try {
      await chrome.identity.removeCachedAuthToken({ token });
    } catch (_) {}
  }

  async function api(path, options = {}, retry = true) {
    let token = await getToken(false);
    let response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });

    if (response.status === 401 && retry) {
      await clearToken(token);
      token = await getToken(false);
      response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...(options.headers || {})
        }
      });
    }

    if (response.status === 204) return null;

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data?.error?.message || `Erro Google Calendar (${response.status})`;
      throw new Error(message);
    }
    return data;
  }

  function toDateTime(date, time) {
    return new Date(`${date}T${time || "00:00"}`).toISOString();
  }

  function recurrenceRule(event) {
    if (!event.recurrence || event.recurrence === "none") return undefined;
    const freq = { daily: "DAILY", weekly: "WEEKLY", monthly: "MONTHLY" }[event.recurrence];
    if (!freq) return undefined;

    let rule = `RRULE:FREQ=${freq}`;
    if (event.repeatUntil) {
      rule += `;UNTIL=${event.repeatUntil.replaceAll("-", "")}T235959Z`;
    }
    return [rule];
  }

  function toGoogleEvent(event) {
    const start = new Date(`${event.date}T${event.time || "00:00"}`);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const reminderMinutes = Number(event.reminderMinutes ?? -1);

    return {
      summary: event.title,
      description: event.notes || "",
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
      recurrence: recurrenceRule(event),
      reminders: reminderMinutes >= 0
        ? { useDefault: false, overrides: [{ method: "popup", minutes: reminderMinutes }] }
        : { useDefault: true },
      extendedProperties: {
        private: {
          minhaMenteId: event.id,
          minhaMenteCategory: event.category || "Pessoal"
        }
      }
    };
  }

  function fromGoogleEvent(item) {
    if (!item?.id || item.status === "cancelled") return null;
    const startRaw = item.start?.dateTime || item.start?.date;
    if (!startRaw) return null;

    const start = new Date(startRaw);
    if (Number.isNaN(start.getTime())) return null;

    const originalLocalId = item.extendedProperties?.private?.minhaMenteId || null;
    const reminder = item.reminders?.overrides?.find(r => r.method === "popup")?.minutes;

    return {
      id: originalLocalId || `google-${item.id}`,
      title: item.summary || "(Sem título)",
      date: [
        start.getFullYear(),
        String(start.getMonth() + 1).padStart(2, "0"),
        String(start.getDate()).padStart(2, "0")
      ].join("-"),
      time: item.start?.date ? "00:00" : `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`,
      category: item.extendedProperties?.private?.minhaMenteCategory || "Google",
      reminderMinutes: Number.isFinite(reminder) ? reminder : -1,
      recurrence: "none",
      repeatUntil: null,
      notes: item.description || "",
      googleEventId: item.id,
      googleRecurringEventId: item.recurringEventId || null,
      googleHtmlLink: item.htmlLink || null,
      googleUpdatedAt: item.updated || null,
      source: "google",
      createdAt: item.created || new Date().toISOString(),
      updatedAt: item.updated || new Date().toISOString()
    };
  }

  async function connect() {
    await getToken(true);
    return true;
  }

  async function disconnect() {
    await chrome.identity.clearAllCachedAuthTokens();
  }

  async function isConnected() {
    if (!isConfigured()) return false;
    try {
      await getToken(false);
      return true;
    } catch (_) {
      return false;
    }
  }

  async function listEvents({ timeMin, timeMax } = {}) {
    const params = new URLSearchParams({
      singleEvents: "true",
      showDeleted: "false",
      maxResults: "2500",
      orderBy: "startTime"
    });
    if (timeMin) params.set("timeMin", timeMin);
    if (timeMax) params.set("timeMax", timeMax);

    const items = [];
    let pageToken = null;

    do {
      if (pageToken) params.set("pageToken", pageToken);
      const data = await api(`/calendars/primary/events?${params.toString()}`);
      items.push(...(data.items || []));
      pageToken = data.nextPageToken || null;
    } while (pageToken);

    return items;
  }

  async function createEvent(event) {
    return api("/calendars/primary/events", {
      method: "POST",
      body: JSON.stringify(toGoogleEvent(event))
    });
  }

  async function updateEvent(event) {
    if (!event.googleEventId) return createEvent(event);
    return api(`/calendars/primary/events/${encodeURIComponent(event.googleEventId)}`, {
      method: "PATCH",
      body: JSON.stringify(toGoogleEvent(event))
    });
  }

  async function deleteEvent(googleEventId) {
    if (!googleEventId) return;
    return api(`/calendars/primary/events/${encodeURIComponent(googleEventId)}`, {
      method: "DELETE"
    });
  }

  async function syncLocalEvents(localEvents) {
    const connected = await isConnected();
    if (!connected) throw new Error("Conecte sua conta Google primeiro.");

    const now = new Date();
    const timeMin = new Date(now.getFullYear() - 1, 0, 1).toISOString();
    const timeMax = new Date(now.getFullYear() + 2, 11, 31, 23, 59, 59).toISOString();

    const uploaded = [];
    for (const event of localEvents) {
      if (event.source === "google" || event.googleEventId) continue;
      const created = await createEvent(event);
      uploaded.push({ localId: event.id, googleEventId: created.id, googleHtmlLink: created.htmlLink || null, googleUpdatedAt: created.updated || null });
    }

    const linkedEvents = localEvents.map(event => {
      const link = uploaded.find(item => item.localId === event.id);
      return link ? { ...event, ...link, source: "local" } : event;
    });

    const googleItems = await listEvents({ timeMin, timeMax });
    const localMasterGoogleIds = new Set(linkedEvents.filter(e => e.googleEventId && e.recurrence && e.recurrence !== "none").map(e => e.googleEventId));
    const byGoogleId = new Map(linkedEvents.filter(e => e.googleEventId).map(e => [e.googleEventId, e]));
    const byLocalId = new Map(linkedEvents.map(e => [e.id, e]));

    for (const item of googleItems) {
      if (item.recurringEventId && localMasterGoogleIds.has(item.recurringEventId)) continue;

      const mapped = fromGoogleEvent(item);
      if (!mapped) continue;

      const privateLocalId = item.extendedProperties?.private?.minhaMenteId;
      if (privateLocalId && byLocalId.has(privateLocalId)) {
        const existing = byLocalId.get(privateLocalId);
        const merged = { ...existing, googleEventId: item.id, googleHtmlLink: item.htmlLink || null, googleUpdatedAt: item.updated || null };
        Object.assign(existing, merged);
        continue;
      }

      const existingByGoogle = byGoogleId.get(item.id);
      if (existingByGoogle) {
        if (existingByGoogle.source === "google") Object.assign(existingByGoogle, mapped);
        continue;
      }

      linkedEvents.push(mapped);
      byGoogleId.set(item.id, mapped);
      byLocalId.set(mapped.id, mapped);
    }

    return linkedEvents;
  }

  return {
    isConfigured,
    connect,
    disconnect,
    isConnected,
    listEvents,
    createEvent,
    updateEvent,
    deleteEvent,
    syncLocalEvents
  };
})();