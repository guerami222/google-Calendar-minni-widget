const { app, BrowserWindow, ipcMain } = require("electron");
const { google } = require("googleapis");
const { OAuth2Client } = require("google-auth-library");
const crypto = require("crypto");
const http = require("http");
const path = require("path");
const fs = require("fs");
const https = require("https");

let mainWindow;

const SCOPES = ["https://www.googleapis.com/auth/calendar"];

const CREDENTIALS_PATH = path.join(__dirname, "credentials.json");
const TOKEN_PATH = path.join(app.getPath("userData"), "google_token.json");
const CONFIG_PATH = path.join(app.getPath("userData"), "config.json");
const BOUNDS_PATH = path.join(app.getPath("userData"), "window-bounds.json");

const DEFAULT_BOUNDS = {
  width: 300,
  height: 500,
  x: 1550,
  y: 300,
};

const DEFAULT_CONFIG = {
  icsUrl: "",
  refreshMinutes: 15,
  maxEvents: 8,
  title: "내 일정",
  opacity: 72,
};

function base64UrlEncode(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest();
}

function loadOAuthCredentials() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error("credentials.json 파일이 없음");
  }

  const raw = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
  const creds = raw.installed || raw.web;

  if (!creds) {
    throw new Error("credentials.json 형식이 올바르지 않음");
  }

  return creds;
}

function ensureConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(
      CONFIG_PATH,
      JSON.stringify(DEFAULT_CONFIG, null, 2),
      "utf-8"
    );
  }

  return CONFIG_PATH;
}

function loadConfig() {
  ensureConfig();

  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    return {
      ...DEFAULT_CONFIG,
      ...saved,
    };
  } catch (err) {
    console.error("설정 불러오기 실패:", err);
    return DEFAULT_CONFIG;
  }
}

function saveConfig(newConfig) {
  const merged = {
    ...DEFAULT_CONFIG,
    ...(newConfig || {}),
  };

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), "utf-8");
  return { ok: true };
}

function loadSavedBounds() {
  try {
    if (fs.existsSync(BOUNDS_PATH)) {
      return JSON.parse(fs.readFileSync(BOUNDS_PATH, "utf-8"));
    }
  } catch (err) {
    console.error("창 위치 불러오기 실패:", err);
  }

  return null;
}

function saveBounds() {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    fs.writeFileSync(
      BOUNDS_PATH,
      JSON.stringify(mainWindow.getBounds(), null, 2),
      "utf-8"
    );
  } catch (err) {
    console.error("창 위치 저장 실패:", err);
  }
}

async function getAuthorizedClient(force = false) {
  const creds = loadOAuthCredentials();

  if (force && fs.existsSync(TOKEN_PATH)) {
    fs.unlinkSync(TOKEN_PATH);
  }

  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));

    const client = new OAuth2Client({
      clientId: creds.client_id,
      clientSecret: creds.client_secret,
    });

    client.setCredentials(token);
    return client;
  }

  return await authorizeWithOAuth(creds);
}

async function authorizeWithOAuth(creds) {
  return await new Promise((resolve, reject) => {
    let authWindow = null;
    let settled = false;

    function safeReject(err) {
      if (settled) return;
      settled = true;

      try {
        server.close();
      } catch (_) {}

      if (authWindow && !authWindow.isDestroyed()) {
        authWindow.close();
      }

      reject(err);
    }

    function safeResolve(client) {
      if (settled) return;
      settled = true;

      try {
        server.close();
      } catch (_) {}

      if (authWindow && !authWindow.isDestroyed()) {
        authWindow.close();
      }

      resolve(client);
    }

    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, "http://127.0.0.1");
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");

        if (error) {
          res.writeHead(400, {
            "Content-Type": "text/html; charset=utf-8",
          });
          res.end("<h2>인증 취소됨</h2>");
          throw new Error(`Google 인증 취소됨: ${error}`);
        }

        if (!code) {
          res.writeHead(400, {
            "Content-Type": "text/plain; charset=utf-8",
          });
          res.end("코드가 없음");
          return;
        }

        const redirectUri = `http://127.0.0.1:${server.address().port}`;

        const client = new OAuth2Client({
          clientId: creds.client_id,
          clientSecret: creds.client_secret,
          redirectUri,
        });

        const tokensResponse = await client.getToken({
          code,
          codeVerifier: server.codeVerifier,
          redirect_uri: redirectUri,
        });

        client.setCredentials(tokensResponse.tokens);

        fs.writeFileSync(
          TOKEN_PATH,
          JSON.stringify(tokensResponse.tokens, null, 2),
          "utf-8"
        );

        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
        });

        res.end(`
          <!doctype html>
          <html lang="ko">
            <head>
              <meta charset="utf-8" />
              <title>인증 완료</title>
            </head>
            <body>
              <h2>인증 완료</h2>
              <p>앱으로 돌아가면 된다.</p>
            </body>
          </html>
        `);

        safeResolve(client);
      } catch (err) {
        safeReject(err);
      }
    });

    server.on("error", safeReject);

    server.listen(0, "127.0.0.1", () => {
      try {
        const port = server.address().port;
        const redirectUri = `http://127.0.0.1:${port}`;

        const codeVerifier = base64UrlEncode(crypto.randomBytes(32));
        const codeChallenge = base64UrlEncode(sha256(codeVerifier));

        server.codeVerifier = codeVerifier;

        const client = new OAuth2Client({
          clientId: creds.client_id,
          clientSecret: creds.client_secret,
          redirectUri,
        });

        const authUrl = client.generateAuthUrl({
          access_type: "offline",
          scope: SCOPES,
          prompt: "consent",
          code_challenge_method: "S256",
          code_challenge: codeChallenge,
        });

        authWindow = new BrowserWindow({
          width: 520,
          height: 720,
          title: "Google 로그인",
          parent: mainWindow || undefined,
          modal: false,
          show: true,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
          },
        });

        authWindow.loadURL(authUrl);

        authWindow.on("closed", () => {
          authWindow = null;

          if (!settled) {
            try {
              server.close();
            } catch (_) {}

            reject(new Error("로그인 창이 닫힘"));
          }
        });
      } catch (err) {
        safeReject(err);
      }
    });
  });
}

function fetchUrl(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (!url) {
      reject(new Error("ICS URL이 비어 있음"));
      return;
    }

    if (redirectCount > 5) {
      reject(new Error("리다이렉트가 너무 많음"));
      return;
    }

    https
      .get(url, (res) => {
        const statusCode = res.statusCode || 0;

        if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
          const nextUrl = new URL(res.headers.location, url).toString();
          resolve(fetchUrl(nextUrl, redirectCount + 1));
          return;
        }

        if (statusCode !== 200) {
          reject(new Error(`ICS 요청 실패: ${statusCode}`));
          return;
        }

        let data = "";

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          resolve(data);
        });
      })
      .on("error", reject);
  });
}

async function listCalendarEvents() {
  const auth = await getAuthorizedClient();
  const calendar = google.calendar({ version: "v3", auth });

  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  const oneYearLater = new Date();
  oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);

  const [eventsResult, colorsResult] = await Promise.all([
    calendar.events.list({
      calendarId: "primary",
      timeMin: oneYearAgo.toISOString(),
      timeMax: oneYearLater.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 1000,
    }),
    calendar.colors.get(),
  ]);

  const eventColors = colorsResult.data.event || {};
  const items = eventsResult.data.items || [];

  return items.map((event) => {
    const startValue = event.start?.dateTime || event.start?.date;
    const endValue = event.end?.dateTime || event.end?.date || startValue;
    const colorInfo = event.colorId ? eventColors[event.colorId] : null;

    return {
      id: event.id,
      calendarId: "primary",
      summary: event.summary || "(제목 없음)",
      description: event.description || "",
      location: event.location || "",
      start: startValue,
      end: endValue,
      colorId: event.colorId || null,
      color: colorInfo?.background || "#60a5fa",
      htmlLink: event.htmlLink || "",
    };
  });
}

async function addCalendarEvent(payload) {
  const auth = await getAuthorizedClient();
  const calendar = google.calendar({ version: "v3", auth });

  let start;
  let end;

  if (payload.allDay) {
    start = { date: payload.startDate };
    end = { date: payload.endDate };
  } else {
    start = {
      dateTime: payload.startDateTime,
      timeZone: "Asia/Seoul",
    };
    end = {
      dateTime: payload.endDateTime,
      timeZone: "Asia/Seoul",
    };
  }

  const event = {
    summary: payload.summary,
    location: payload.location || undefined,
    description: payload.description || undefined,
    start,
    end,
  };

  if (payload.colorId) {
    event.colorId = payload.colorId;
  }

  const result = await calendar.events.insert({
    calendarId: "primary",
    requestBody: event,
  });

  return {
    id: result.data.id,
    htmlLink: result.data.htmlLink,
    status: result.data.status,
  };
}

async function deleteCalendarEvent(payload) {
  const auth = await getAuthorizedClient();
  const calendar = google.calendar({ version: "v3", auth });

  await calendar.events.delete({
    calendarId: payload.calendarId || "primary",
    eventId: payload.eventId,
    sendUpdates: "none",
  });

  return { ok: true };
}

async function updateCalendarTitle(payload) {
  const auth = await getAuthorizedClient();
  const calendar = google.calendar({ version: "v3", auth });

  const result = await calendar.events.patch({
    calendarId: payload.calendarId || "primary",
    eventId: payload.eventId,
    requestBody: {
      summary: payload.summary,
    },
    sendUpdates: "none",
  });

  return {
    id: result.data.id,
    summary: result.data.summary || "",
  };
}

function createWindow() {
  const savedBounds = loadSavedBounds();

  mainWindow = new BrowserWindow({
    width: savedBounds?.width || DEFAULT_BOUNDS.width,
    height: savedBounds?.height || DEFAULT_BOUNDS.height,
    x: savedBounds?.x ?? DEFAULT_BOUNDS.x,
    y: savedBounds?.y ?? DEFAULT_BOUNDS.y,

    minWidth: 240,
    minHeight: 360,

    frame: false,
    resizable: false,
    transparent: true,
    alwaysOnTop: false,
    skipTaskbar: false,
    title: "Google Calendar Widget",
    icon: path.join(__dirname, "icon.ico"),
    backgroundColor: "#00000000",
    hasShadow: false,

    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on("close", saveBounds);
  mainWindow.loadFile("index.html");
}

function registerIpcHandlers() {
  ipcMain.handle("auth:login", async () => {
    await getAuthorizedClient(true);
    return fs.existsSync(TOKEN_PATH);
  });

  ipcMain.handle("auth:status", async () => {
    return fs.existsSync(TOKEN_PATH);
  });

  ipcMain.handle("auth:logout", async () => {
    if (fs.existsSync(TOKEN_PATH)) {
      fs.unlinkSync(TOKEN_PATH);
    }

    return !fs.existsSync(TOKEN_PATH);
  });

  ipcMain.handle("config:load", async () => {
    return loadConfig();
  });

  ipcMain.handle("config:save", async (_, newConfig) => {
    return saveConfig(newConfig);
  });

  ipcMain.handle("startup:get", async () => {
    return app.getLoginItemSettings().openAtLogin;
  });

  ipcMain.handle("startup:set", async (_, enabled) => {
    app.setLoginItemSettings({
      openAtLogin: Boolean(enabled),
      path: process.execPath,
    });

    return app.getLoginItemSettings().openAtLogin;
  });

  ipcMain.handle("window:minimize", async () => {
    if (mainWindow) mainWindow.minimize();
    return true;
  });

  ipcMain.handle("window:close", async () => {
    app.quit();
    return true;
  });

  ipcMain.handle("window:toggleAlwaysOnTop", async () => {
    if (!mainWindow) return false;

    const next = !mainWindow.isAlwaysOnTop();
    mainWindow.setAlwaysOnTop(next);

    return next;
  });

  ipcMain.handle("window:getAlwaysOnTop", async () => {
    if (!mainWindow) return false;
    return mainWindow.isAlwaysOnTop();
  });

  ipcMain.handle("window:resetSize", async () => {
    if (!mainWindow) return false;

    const current = mainWindow.getBounds();

    mainWindow.setBounds({
      x: current.x,
      y: current.y,
      width: DEFAULT_BOUNDS.width,
      height: DEFAULT_BOUNDS.height,
    });

    saveBounds();
    return true;
  });

  ipcMain.handle("ics:fetch", async (_, icsUrl) => {
    return await fetchUrl(icsUrl);
  });

  ipcMain.handle("calendar:list", async () => {
    return await listCalendarEvents();
  });

  ipcMain.handle("calendar:listEvents", async () => {
    return await listCalendarEvents();
  });

  ipcMain.handle("calendar:add", async (_, payload) => {
    return await addCalendarEvent(payload);
  });

  ipcMain.handle("calendar:addEvent", async (_, payload) => {
    return await addCalendarEvent(payload);
  });

  ipcMain.handle("calendar:createEvent", async (_, payload) => {
    return await addCalendarEvent(payload);
  });

  ipcMain.handle("calendar:delete", async (_, payload) => {
    return await deleteCalendarEvent(payload);
  });

  ipcMain.handle("calendar:deleteEvent", async (_, payload) => {
    return await deleteCalendarEvent(payload);
  });

  ipcMain.handle("calendar:removeEvent", async (_, payload) => {
    return await deleteCalendarEvent(payload);
  });

  ipcMain.handle("calendar:updateTitle", async (_, payload) => {
    return await updateCalendarTitle(payload);
  });

  ipcMain.handle("calendar:updateEventTitle", async (_, payload) => {
    return await updateCalendarTitle(payload);
  });

  ipcMain.on("resize-window", (event, { width, height }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;

    const bounds = win.getBounds();

    win.setBounds({
      x: bounds.x,
      y: bounds.y,
      width: Math.max(240, Math.round(width)),
      height: Math.max(360, Math.round(height)),
    });

    saveBounds();
  });
}

app.whenReady().then(() => {
  ensureConfig();
  registerIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});