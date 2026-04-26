let timer = null;
let currentMonthDate = new Date();
let selectedDateKey = null;
let latestItems = [];
let selectedColorId = "";

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(date) {
  const d = new Date(date);
  return d.toLocaleString("ko-KR", {
    month: "short",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function isAllDay(start, end) {
  return (
    start.getHours() === 0 &&
    start.getMinutes() === 0 &&
    end.getHours() === 0 &&
    end.getMinutes() === 0 &&
    (end - start) % (24 * 60 * 60 * 1000) === 0
  );
}

function getDateKey(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatMonthLabel(date) {
  const d = new Date(date);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
}

function formatSelectedDateLabel(dateKey) {
  if (!dateKey) return "선택한 날짜 일정";

  const [year, month, day] = dateKey.split("-").map(Number);
  const d = new Date(year, month - 1, day);

  return (
    d.toLocaleDateString("ko-KR", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "long"
    }) + " 일정"
  );
}

function unfoldICSLines(text) {
  const normalized = text.replace(/\r\n/g, "\n");
  const rawLines = normalized.split("\n");
  const lines = [];

  for (const line of rawLines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }

  return lines;
}

function normalizeColor(value) {
  if (!value) return null;

  const trimmed = String(value).trim();

  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed;
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) return `#${trimmed}`;

  return null;
}

function parseICS(text) {
  const lines = unfoldICSLines(text);
  const events = [];
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line === "BEGIN:VEVENT") {
      current = {};
      continue;
    }

    if (line === "END:VEVENT") {
      if (current) events.push(current);
      current = null;
      continue;
    }

    if (!current) continue;

    const idx = line.indexOf(":");
    if (idx === -1) continue;

    const rawKey = line.slice(0, idx);
    const value = line.slice(idx + 1).trim();
    const key = rawKey.split(";")[0];

    if (key === "SUMMARY") current.summary = value;
    if (key === "DESCRIPTION") current.description = value.replace(/\\n/g, " ");
    if (key === "LOCATION") current.location = value;
    if (key === "DTSTART") current.start = parseICalDate(value);
    if (key === "DTEND") current.end = parseICalDate(value);
    if (key === "UID") current.id = value;

    if (key === "COLOR") current.color = normalizeColor(value) || value;
    if (key === "CATEGORIES") current.categories = value;
    if (rawKey.startsWith("X-APPLE-CALENDAR-COLOR")) current.color = normalizeColor(value) || value;
    if (rawKey.startsWith("X-GOOGLE-CALENDAR-COLOR")) current.color = normalizeColor(value) || value;
  }

  return events;
}

function parseICalDate(value) {
  if (/^\d{8}$/.test(value)) {
    return new Date(
      Number(value.slice(0, 4)),
      Number(value.slice(4, 6)) - 1,
      Number(value.slice(6, 8))
    );
  }

  if (/^\d{8}T\d{6}Z$/.test(value)) {
    const iso =
      `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` +
      `T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`;
    return new Date(iso);
  }

  if (/^\d{8}T\d{6}$/.test(value)) {
    return new Date(
      Number(value.slice(0, 4)),
      Number(value.slice(4, 6)) - 1,
      Number(value.slice(6, 8)),
      Number(value.slice(9, 11)),
      Number(value.slice(11, 13)),
      Number(value.slice(13, 15))
    );
  }

  return new Date(value);
}

function getEventColor(item) {
  return normalizeColor(item?.color) || "#60a5fa";
}

function groupEventsByDate(items) {
  const map = {};

  items.forEach(item => {
    const start = new Date(item.start);
    const end = new Date(item.end || item.start);

    const current = new Date(start);
    current.setHours(0, 0, 0, 0);

    const last = new Date(end);
    last.setHours(0, 0, 0, 0);

    while (current <= last) {
      const key = getDateKey(current);
      if (!map[key]) map[key] = [];
      map[key].push(item);
      current.setDate(current.getDate() + 1);
    }
  });

  return map;
}

function renderWeekdays() {
  const weekdaysEl = document.getElementById("calendarWeekdays");
  if (!weekdaysEl) return;

  const names = ["일", "월", "화", "수", "목", "금", "토"];
  weekdaysEl.innerHTML = names
    .map(name => `<div class="calendar-weekday">${name}</div>`)
    .join("");
}

function applyEventsHeight() {
  const app = document.querySelector(".app");
  const eventsEl = document.getElementById("events");

  if (!app || !eventsEl) return;

  const appRect = app.getBoundingClientRect();
  const eventsRect = eventsEl.getBoundingClientRect();
  const available = Math.max(80, appRect.bottom - eventsRect.top - 8);

  eventsEl.style.height = `${available}px`;
}

async function handleDeleteEvent(iCalUID) {
  if (!iCalUID) return;

  try {
    await window.widgetAPI.deleteEvent({
      calendarId: "primary",
      eventId: iCalUID
    });

    const latestConfig = await window.widgetAPI.loadConfig();
    await fetchEvents(latestConfig);

  } catch (err) {
    console.error(err);
  }
}

function renderEventListForSelectedDate(itemsByDate) {
  const eventsEl = document.getElementById("events");
  const selectedDateLabel = document.getElementById("selectedDateLabel");

  if (!eventsEl || !selectedDateLabel) return;

  selectedDateLabel.textContent = formatSelectedDateLabel(selectedDateKey);

  const selectedItems = selectedDateKey ? (itemsByDate[selectedDateKey] || []) : [];

  if (!selectedItems.length) {
    eventsEl.innerHTML = `
      <div class="empty">
        그날은 일정이 없다.
      </div>
    `;
    requestAnimationFrame(applyEventsHeight);
    return;
  }

  eventsEl.innerHTML = selectedItems.map(item => {
    const start = new Date(item.start);
    const end = new Date(item.end || item.start);

    const when = isAllDay(start, end)
      ? "종일"
      : `${formatDate(start)} ~ ${new Date(end).toLocaleTimeString("ko-KR", {
          hour: "2-digit",
          minute: "2-digit"
        })}`;

    const color = getEventColor(item);
    const eventId = item.id ? escapeHtml(item.id) : "";
    const location = item.location ? `<div>📍 ${escapeHtml(item.location)}</div>` : "";
    const desc = item.description ? `<div>${escapeHtml(item.description).slice(0, 80)}</div>` : "";

    return `
      <div class="event" style="border-left: 4px solid ${color}; padding-left: 8px;">
        <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:8px;">
          <div style="min-width:0; flex:1;">
            <div class="when">${when}</div>
           <div class="summary editable-summary" data-event-id="${eventId}">
  ${escapeHtml(item.summary || "(제목 없음)")}
</div>
          </div>
          <button class="delete-event-btn" data-event-id="${eventId}" title="일정 삭제">✕</button>
        </div>
        <div class="meta">
          ${location}
          ${desc}
        </div>
      </div>
    `;
  }).join("");


eventsEl.querySelectorAll(".editable-summary").forEach(summaryEl => {
  summaryEl.addEventListener("dblclick", () => {
    const eventId = summaryEl.dataset.eventId;
    if (!eventId) return;

    const oldTitle = summaryEl.textContent.trim();
    const input = document.createElement("input");

    input.className = "summary-edit-input";
    input.value = oldTitle === "(제목 없음)" ? "" : oldTitle;

    summaryEl.replaceWith(input);
    input.focus();
    input.select();

    let saved = false; // 중복 실행 방지

    async function saveTitle() {
      if (saved) return;
      saved = true;

      const newTitle = input.value.trim() || "(제목 없음)";

      try {
        await window.widgetAPI.updateEventTitle({
          calendarId: "primary",
          eventId,
          summary: newTitle
        });

        // 먼저 UI 반영 (중요)
        const newEl = document.createElement("div");
        newEl.className = "summary editable-summary";
        newEl.dataset.eventId = eventId;
        newEl.textContent = newTitle;

        input.replaceWith(newEl);

        // 그 다음 동기화
        const latestConfig = await window.widgetAPI.loadConfig();
        await fetchEvents(latestConfig);

      } catch (err) {
        console.error(err);
        await fetchEvents(await window.widgetAPI.loadConfig());
      }
    }

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault(); // 이거 없으면 blur까지 터짐
        saveTitle();
      }

      if (e.key === "Escape") {
        saved = true;
        fetchEvents(window.widgetAPI.loadConfig());
      }
    });

    input.addEventListener("blur", () => {
      saveTitle();
    });
  });
});


  eventsEl.querySelectorAll(".delete-event-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const eventId = btn.dataset.eventId;
      await handleDeleteEvent(eventId);
    });
  });

  requestAnimationFrame(applyEventsHeight);
}

function renderCalendar(items) {
  const calendarGrid = document.getElementById("calendarGrid");
  const currentMonthLabel = document.getElementById("currentMonthLabel");

  if (!calendarGrid || !currentMonthLabel) return;

  const year = currentMonthDate.getFullYear();
  const month = currentMonthDate.getMonth();
  const todayKey = getDateKey(new Date());

  currentMonthLabel.textContent = formatMonthLabel(currentMonthDate);

  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay();
  const firstGridDate = new Date(year, month, 1 - startWeekday);

  const itemsByDate = groupEventsByDate(items);

  let html = "";

  for (let i = 0; i < 42; i++) {
    const cellDate = new Date(firstGridDate);
    cellDate.setDate(firstGridDate.getDate() + i);

    const dateKey = getDateKey(cellDate);
    const isCurrentMonth = cellDate.getMonth() === month;
    const dayItems = itemsByDate[dateKey] || [];

    const classes = [
      "calendar-cell",
      !isCurrentMonth ? "other-month" : "",
      dayItems.length ? "has-event" : "",
      selectedDateKey === dateKey ? "selected" : "",
      todayKey === dateKey ? "today" : ""
    ].filter(Boolean).join(" ");

    html += `
      <div class="${classes}" data-date="${dateKey}">
        <div class="calendar-date">${cellDate.getDate()}</div>
        <div class="calendar-dots">
          ${dayItems.slice(0, 4).map(item => {
            const dotColor = getEventColor(item);
            return `<span class="event-dot" style="background:${dotColor}"></span>`;
          }).join("")}
        </div>
      </div>
    `;
  }

  calendarGrid.innerHTML = html;

  calendarGrid.querySelectorAll(".calendar-cell").forEach(cell => {
    cell.addEventListener("click", () => {
      selectedDateKey = cell.dataset.date;
      renderCalendar(latestItems);
    });
  });

  renderEventListForSelectedDate(itemsByDate);
}

async function fetchEvents(config = {}) {
  const status = document.getElementById("status");
  const eventsEl = document.getElementById("events");
  const emptyEl = document.getElementById("empty");
  const widgetTitle = document.getElementById("widgetTitle");

  if (widgetTitle) {
    widgetTitle.textContent = config.title || "내 일정";
  }

  try {
    const loggedIn = await window.widgetAPI.getAuthStatus();

    console.log("fetchEvents 로그인 상태:", loggedIn);

    if (!loggedIn) {
      latestItems = [];
      selectedDateKey = getDateKey(new Date());
      currentMonthDate = new Date();

      renderWeekdays();
      renderCalendar([]);

      if (status) status.textContent = "로그인 필요";

      if (eventsEl) {
        eventsEl.innerHTML = `
          <div class="empty">
            Google Calendar 로그인이 필요하다.
          </div>
        `;
      }

      emptyEl?.classList.add("hidden");

      requestAnimationFrame(applyEventsHeight);
      return;
    }

    if (status) status.textContent = "일정 불러오는 중...";
    emptyEl?.classList.add("hidden");

    const items = await window.widgetAPI.listEvents();

    latestItems = items
      .filter(e => e.start)
      .sort((a, b) => new Date(a.start) - new Date(b.start));

    if (!selectedDateKey) {
      selectedDateKey = getDateKey(new Date());
    }

    currentMonthDate = new Date(
      Number(selectedDateKey.slice(0, 4)),
      Number(selectedDateKey.slice(5, 7)) - 1,
      1
    );

    renderWeekdays();
    renderCalendar(latestItems);

    if (!latestItems.length) {
      emptyEl?.classList.remove("hidden");
    } else {
      emptyEl?.classList.add("hidden");
    }

    if (status) {
      status.textContent = `업데이트 ${new Date().toLocaleTimeString("ko-KR")}`;
    }

    requestAnimationFrame(applyEventsHeight);
  } catch (err) {
    if (status) status.textContent = `실패: ${err.message}`;
    if (eventsEl) eventsEl.innerHTML = "";
    emptyEl?.classList.remove("hidden");
    console.error(err);
  }
}

function startRefresh(config) {
  if (timer) clearInterval(timer);
  fetchEvents(config);
  timer = setInterval(() => fetchEvents(config), (config.refreshMinutes || 15) * 60 * 1000);
}
async function init() {
  const pinBtn = document.getElementById("pinBtn");
  const addEventBtn = document.getElementById("addEventBtn");
  const addEventPanel = document.getElementById("addEventPanel");
  const saveEventBtn = document.getElementById("saveEventBtn");
  const cancelEventBtn = document.getElementById("cancelEventBtn");

  const eventTitleInput = document.getElementById("eventTitleInput");
  const eventDateInput = document.getElementById("eventDateInput");
  const eventStartTimeInput = document.getElementById("eventStartTimeInput");
  const eventEndTimeInput = document.getElementById("eventEndTimeInput");
  const eventLocationInput = document.getElementById("eventLocationInput");
  const eventDescInput = document.getElementById("eventDescInput");

  const loginBtn = document.getElementById("loginBtn");
  const accountStatus = document.getElementById("accountStatus");

  const opacityInput = document.getElementById("opacityInput");
  const opacityValue = document.getElementById("opacityValue");

  const settingsBtn = document.getElementById("settingsBtn");
  const settingsPanel = document.getElementById("settingsPanel");
  const saveBtn = document.getElementById("saveBtn");
  const cancelBtn = document.getElementById("cancelBtn");
  const startupBtn = document.getElementById("startupBtn");
  const resetSizeBtn = document.getElementById("resetSizeBtn");

  const titleInput = document.getElementById("titleInput");
  const refreshInput = document.getElementById("refreshInput");
  const maxEventsInput = document.getElementById("maxEventsInput");

  const prevMonthBtn = document.getElementById("prevMonthBtn");
  const nextMonthBtn = document.getElementById("nextMonthBtn");
  const minBtn = document.getElementById("minBtn");
  const closeBtn = document.getElementById("closeBtn");

  const colorDots = document.querySelectorAll(".color-dot");
  const handle = document.querySelector(".resize-handle");

  let config = await window.widgetAPI.loadConfig();

  if (titleInput) titleInput.value = config.title || "내 일정";
  if (refreshInput) refreshInput.value = config.refreshMinutes || 15;
  if (maxEventsInput) maxEventsInput.value = config.maxEvents || 8;

  const opacity = config.opacity ?? 72;
  if (opacityInput) opacityInput.value = opacity;
  if (opacityValue) opacityValue.textContent = `${opacity}%`;
  document.documentElement.style.setProperty("--app-opacity", String(opacity / 100));

  function updatePinButton(isPinned) {
    if (!pinBtn) return;
    pinBtn.textContent = isPinned ? "📍" : "📌";
    pinBtn.title = isPinned ? "항상 위 고정 해제" : "항상 위 고정";
  }

  async function updateStartupButton() {
    if (!startupBtn || !window.widgetAPI.getStartup) return;

    const enabled = await window.widgetAPI.getStartup();
    startupBtn.textContent = enabled ? "ON" : "OFF";
    startupBtn.classList.toggle("primary", enabled);
  }

  async function updateLoginButton() {
    if (!loginBtn || !window.widgetAPI.getAuthStatus) return;

    const loggedIn = await window.widgetAPI.getAuthStatus();
if (!loggedIn) {
  return;
}

    console.log("현재 로그인 상태:", loggedIn);

    loginBtn.textContent = loggedIn ? "로그아웃" : "로그인";
    loginBtn.classList.toggle("primary", loggedIn);

    if (accountStatus) {
      accountStatus.textContent = loggedIn
        ? "Google Calendar 연결됨"
        : "로그인 필요";
    }
  }

  function openAddEventPanel() {
    settingsPanel?.classList.add("hidden");
    addEventPanel?.classList.remove("hidden");

    if (selectedDateKey && eventDateInput) {
      eventDateInput.value = selectedDateKey;
    }
  }

  function toggleAddEventPanel() {
    const willOpen = addEventPanel?.classList.contains("hidden");

    if (willOpen) {
      openAddEventPanel();
    } else {
      addEventPanel?.classList.add("hidden");
    }
  }

  handle?.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();

    const startX = e.screenX;
    const startY = e.screenY;
    const startWidth = window.outerWidth;
    const startHeight = window.outerHeight;

    function onMove(moveEvent) {
      if (moveEvent.buttons !== 1) {
        stop();
        return;
      }

      const nextWidth = Math.max(240, startWidth + (moveEvent.screenX - startX));
      const nextHeight = Math.max(360, startHeight + (moveEvent.screenY - startY));

      window.widgetAPI.resizeWindow(nextWidth, nextHeight);
    }

    function stop() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", stop);
      window.removeEventListener("blur", stop);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", stop);
    window.addEventListener("blur", stop);
  });

  minBtn?.addEventListener("click", () => {
    window.widgetAPI.minimize();
  });

  closeBtn?.addEventListener("click", () => {
    window.widgetAPI.close();
  });

  try {
    const initialPinned = await window.widgetAPI.getAlwaysOnTop();
    updatePinButton(initialPinned);
  } catch (e) {
    console.error("항상 위 상태 확인 실패:", e);
  }

  pinBtn?.addEventListener("click", async () => {
    try {
      const isPinned = await window.widgetAPI.toggleAlwaysOnTop();
      updatePinButton(isPinned);
    } catch (e) {
      console.error("항상 위 토글 실패:", e);
    }
  });

  settingsBtn?.addEventListener("click", async () => {
    const willOpen = settingsPanel?.classList.contains("hidden");

    addEventPanel?.classList.add("hidden");

    if (willOpen) {
      settingsPanel?.classList.remove("hidden");

      try {
        await updateLoginButton();
      } catch (e) {
        console.error("설정창 로그인 상태 갱신 실패:", e);
      }

      try {
        await updateStartupButton();
      } catch (e) {
        console.error("설정창 시작프로그램 상태 갱신 실패:", e);
      }
    } else {
      settingsPanel?.classList.add("hidden");
    }
  });

  cancelBtn?.addEventListener("click", () => {
    settingsPanel?.classList.add("hidden");
  });

  resetSizeBtn?.addEventListener("click", async () => {
    await window.widgetAPI.resetSize();

    const defaultOpacity = 72;

    if (opacityInput) opacityInput.value = defaultOpacity;
    if (opacityValue) opacityValue.textContent = `${defaultOpacity}%`;

    document.documentElement.style.setProperty(
      "--app-opacity",
      String(defaultOpacity / 100)
    );

    config.opacity = defaultOpacity;
    await window.widgetAPI.saveConfig(config);

    requestAnimationFrame(applyEventsHeight);
  });

  startupBtn?.addEventListener("click", async () => {
    if (!window.widgetAPI.getStartup || !window.widgetAPI.setStartup) {
      console.error("startup API 연결 안 됨");
      return;
    }

    const current = await window.widgetAPI.getStartup();
    const next = await window.widgetAPI.setStartup(!current);

    startupBtn.textContent = next ? "ON" : "OFF";
    startupBtn.classList.toggle("primary", next);
  });

  saveBtn?.addEventListener("click", async () => {
    config = {
      title: titleInput?.value.trim() || "내 일정",
      refreshMinutes: Number(refreshInput?.value) || 15,
      maxEvents: Number(maxEventsInput?.value) || 8,
      opacity: Number(opacityInput?.value) || 72
    };

    await window.widgetAPI.saveConfig(config);

    settingsPanel?.classList.add("hidden");
    selectedDateKey = null;
    startRefresh(config);
  });

  opacityInput?.addEventListener("input", () => {
    const value = Number(opacityInput.value) || 72;

    document.documentElement.style.setProperty("--app-opacity", String(value / 100));

    if (opacityValue) {
      opacityValue.textContent = `${value}%`;
    }
  });

  loginBtn?.addEventListener("click", async () => {
    try {
      const loggedIn = await window.widgetAPI.getAuthStatus();

if (loggedIn) {
  await window.widgetAPI.logout();

  latestItems = [];
  selectedDateKey = getDateKey(new Date());
  currentMonthDate = new Date();

  renderWeekdays();
  renderCalendar([]);

  const status = document.getElementById("status");
  const eventsEl = document.getElementById("events");

  if (status) status.textContent = "로그인 필요";

  if (eventsEl) {
    eventsEl.innerHTML = `
      <div class="empty">
        Google Calendar 로그인이 필요하다.
      </div>
    `;
  }

  await updateLoginButton();
  return;
}

      const loginOk = await window.widgetAPI.login();

      if (!loginOk) {
        throw new Error("로그인은 끝났는데 토큰 저장 확인 실패");
      }

      await updateLoginButton();

      config = await window.widgetAPI.loadConfig();
      startRefresh(config);
    } catch (e) {
      console.error(e);
      alert(`로그인 처리 실패: ${e.message}`);
    }
  });

  prevMonthBtn?.addEventListener("click", () => {
    currentMonthDate = new Date(
      currentMonthDate.getFullYear(),
      currentMonthDate.getMonth() - 1,
      1
    );

    renderCalendar(latestItems);
    requestAnimationFrame(applyEventsHeight);
  });

  nextMonthBtn?.addEventListener("click", () => {
    currentMonthDate = new Date(
      currentMonthDate.getFullYear(),
      currentMonthDate.getMonth() + 1,
      1
    );

    renderCalendar(latestItems);
    requestAnimationFrame(applyEventsHeight);
  });

  addEventBtn?.addEventListener("click", toggleAddEventPanel);

  cancelEventBtn?.addEventListener("click", () => {
    addEventPanel?.classList.add("hidden");
  });

  colorDots.forEach(dot => {
    dot.addEventListener("click", () => {
      colorDots.forEach(d => d.classList.remove("selected"));
      dot.classList.add("selected");
      selectedColorId = dot.dataset.colorId || "";
    });
  });

  saveEventBtn?.addEventListener("click", async () => {
    try {
      const title = eventTitleInput?.value.trim() || "";
      const date = eventDateInput?.value || "";
      const start = eventStartTimeInput?.value || "";
      const end = eventEndTimeInput?.value || "";
      const location = eventLocationInput?.value.trim() || "";
      const description = eventDescInput?.value.trim() || "";

      if (!title || !date) {
        alert("제목이랑 날짜는 넣어라");
        return;
      }

      const payload = start && end
        ? {
            summary: title,
            startDateTime: `${date}T${start}:00`,
            endDateTime: `${date}T${end}:00`,
            location,
            description,
            colorId: selectedColorId || undefined
          }
        : {
            summary: title,
            allDay: true,
            startDate: date,
            endDate: date,
            location,
            description,
            colorId: selectedColorId || undefined
          };

      await window.widgetAPI.createEvent(payload);

      if (eventTitleInput) eventTitleInput.value = "";
      if (eventDateInput) eventDateInput.value = "";
      if (eventStartTimeInput) eventStartTimeInput.value = "";
      if (eventEndTimeInput) eventEndTimeInput.value = "";
      if (eventLocationInput) eventLocationInput.value = "";
      if (eventDescInput) eventDescInput.value = "";

      selectedColorId = "";
      colorDots.forEach(dot => dot.classList.remove("selected"));
      colorDots[0]?.classList.add("selected");

      addEventPanel?.classList.add("hidden");

      config = await window.widgetAPI.loadConfig();
      await fetchEvents(config);
    } catch (e) {
      console.error(e);
      alert(`일정 추가 실패: ${e.message}`);
    }
  });

  document.addEventListener("keydown", (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (!selectedDateKey) return;

    const d = new Date(selectedDateKey);

    if (e.key === "ArrowLeft") d.setDate(d.getDate() - 1);
    if (e.key === "ArrowRight") d.setDate(d.getDate() + 1);
    if (e.key === "ArrowUp") d.setDate(d.getDate() - 7);
    if (e.key === "ArrowDown") d.setDate(d.getDate() + 7);

    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
      selectedDateKey = getDateKey(d);
      currentMonthDate = new Date(d.getFullYear(), d.getMonth(), 1);
      renderCalendar(latestItems);
      requestAnimationFrame(applyEventsHeight);
    }

    if (e.key.toLowerCase() === "t") {
      const today = new Date();

      selectedDateKey = getDateKey(today);
      currentMonthDate = new Date(today.getFullYear(), today.getMonth(), 1);

      renderCalendar(latestItems);
      requestAnimationFrame(applyEventsHeight);
    }

    if (e.key.toLowerCase() === "n") {
      toggleAddEventPanel();
    }
  });

  renderWeekdays();

  try {
    await updateLoginButton();
  } catch (e) {
    console.error("로그인 버튼 상태 갱신 실패:", e);
  }

  try {
    await updateStartupButton();
  } catch (e) {
    console.error("시작프로그램 상태 확인 실패:", e);
  }

  try {
    startRefresh(config);
  } catch (e) {
    console.error("일정 불러오기 시작 실패:", e);
  }
}


init().then(() => {
  requestAnimationFrame(applyEventsHeight);
  window.addEventListener("resize", applyEventsHeight);
}).catch(err => {
  console.error("INIT ERROR:", err);
});