const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');
const crypto = require('crypto');
const http = require('http');
const path = require('path');
const fs = require('fs');
const https = require('https');

let mainWindow;
const SCOPES = [
  'https://www.googleapis.com/auth/calendar'
];
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const TOKEN_PATH = path.join(app.getPath('userData'), 'google_token.json');
const DEFAULT_BOUNDS = {
  width: 300,
  height: 500,
  x: 1550,
  y: 300
};

function base64UrlEncode(buffer) {
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest();
}

function loadOAuthCredentials() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error('credentials.json 파일이 없음');
  }

  const raw = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
  const creds = raw.installed || raw.web;
  if (!creds) throw new Error('credentials.json 형식이 올바르지 않음');

  return creds;
}

async function getAuthorizedClient() {
  const creds = loadOAuthCredentials();

  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    const client = new OAuth2Client({
      clientId: creds.client_id,
      clientSecret: creds.client_secret
    });
    client.setCredentials(token);
    return client;
  }

  return await authorizeWithOAuth(creds);
}

async function authorizeWithOAuth(creds) {
  return await new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, 'http://127.0.0.1');
        const code = url.searchParams.get('code');

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('코드가 없음');
          return;
        }

        const redirectUri = `http://127.0.0.1:${server.address().port}`;
        const client = new OAuth2Client({
          clientId: creds.client_id,
          clientSecret: creds.client_secret,
          redirectUri
        });

        const tokensResponse = await client.getToken({
          code,
          codeVerifier: server.codeVerifier,
          redirect_uri: redirectUri
        });

        client.setCredentials(tokensResponse.tokens);
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokensResponse.tokens, null, 2), 'utf-8');

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h2>인증 완료</h2><p>이 창 닫아도 됨.</p>');

        server.close();
        resolve(client);
      } catch (err) {
        reject(err);
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const redirectUri = `http://127.0.0.1:${port}`;

      const codeVerifier = base64UrlEncode(crypto.randomBytes(32));
      const codeChallenge = base64UrlEncode(sha256(codeVerifier));
      server.codeVerifier = codeVerifier;

      const client = new OAuth2Client({
        clientId: creds.client_id,
        clientSecret: creds.client_secret,
        redirectUri
      });

      const authUrl = client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent',
        code_challenge_method: 'S256',
        code_challenge: codeChallenge
      });

      require('electron').shell.openExternal(authUrl);
    });
  });
}

function ensureConfig() {
  const configPath = path.join(app.getPath('userData'), 'config.json');
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify({
      icsUrl: "",
      refreshMinutes: 15,
      maxEvents: 8,
      title: "내 일정"
    }, null, 2), 'utf-8');
  }
  return configPath;
}
const boundsPath = path.join(app.getPath('userData'), 'window-bounds.json');

function loadSavedBounds() {
  try {
    if (fs.existsSync(boundsPath)) {
      return JSON.parse(fs.readFileSync(boundsPath, 'utf-8'));
    }
  } catch (err) {
    console.error('창 위치 불러오기 실패:', err);
  }
  return null;
}

function saveBounds() {
  try {
    if (!mainWindow) return;
    fs.writeFileSync(
      boundsPath,
      JSON.stringify(mainWindow.getBounds(), null, 2),
      'utf-8'
    );
  } catch (err) {
    console.error('창 위치 저장 실패:', err);
  }
}
function createWindow() {


  const savedBounds = loadSavedBounds();

  mainWindow = new BrowserWindow({
width: savedBounds?.width || defaultBounds.width,
height: savedBounds?.height || defaultBounds.height,
x: savedBounds?.x ?? defaultBounds.x,
y: savedBounds?.y ?? defaultBounds.y,

  minWidth: 240,
  minHeight: 360,


    frame: false,
    resizable: false,
    transparent: true,
    alwaysOnTop: false,
    skipTaskbar: false,
    title: 'Google Calendar Widget',
    icon: path.join(__dirname, 'icon.ico'),
    backgroundColor: '#00000000',
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });



  mainWindow.on('close', saveBounds);

  mainWindow.loadFile('index.html');
}
app.whenReady().then(() => {
  ensureConfig();
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('config:load', async () => {
  const configPath = ensureConfig();
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
});

ipcMain.handle('startup:get', () => {
  return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle('startup:set', (_, enabled) => {
  app.setLoginItemSettings({
    openAtLogin: Boolean(enabled),
path: process.execPath
  });

  return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle('config:save', async (_, newConfig) => {
  const configPath = ensureConfig();
  fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), 'utf-8');
  return { ok: true };
});

ipcMain.handle('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('window:close', () => {
  app.quit();
});
ipcMain.handle('window:toggleAlwaysOnTop', () => {
  if (!mainWindow) return false;
  const next = !mainWindow.isAlwaysOnTop();
  mainWindow.setAlwaysOnTop(next);
  return next;
});

ipcMain.handle('window:getAlwaysOnTop', () => {
  if (!mainWindow) return false;
  return mainWindow.isAlwaysOnTop();
});

ipcMain.handle('calendar:createEvent', async (_, payload) => {
  const auth = await getAuthorizedClient();
  const calendar = google.calendar({ version: 'v3', auth });

  let start;
  let end;

  if (payload.allDay) {
    start = { date: payload.startDate };
    end = { date: payload.endDate };
  } else {
    start = {
      dateTime: payload.startDateTime,
      timeZone: 'Asia/Seoul'
    };
    end = {
      dateTime: payload.endDateTime,
      timeZone: 'Asia/Seoul'
    };
  }

  const event = {
    summary: payload.summary,
    location: payload.location || undefined,
    description: payload.description || undefined,
    start,
    end
  };

  if (payload.colorId) {
    event.colorId = payload.colorId;
  }

  const result = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: event
  });

  return {
    id: result.data.id,
    htmlLink: result.data.htmlLink,
    status: result.data.status
  };
});

ipcMain.handle('calendar:deleteEvent', async (_, payload) => {
  const auth = await getAuthorizedClient();
  const calendar = google.calendar({ version: 'v3', auth });

  await calendar.events.delete({
    calendarId: payload.calendarId || 'primary',
    eventId: payload.eventId,
    sendUpdates: 'none'
  });

  return { ok: true };
});

ipcMain.handle('window:resetSize', () => {
  if (!mainWindow) return false;

  const current = mainWindow.getBounds();

  mainWindow.setBounds({
    x: current.x,
    y: current.y,
    width: DEFAULT_BOUNDS.width,
    height: DEFAULT_BOUNDS.height
  });

  saveBounds();
  return true;
});

ipcMain.handle('calendar:updateEventTitle', async (_, payload) => {
  const auth = await getAuthorizedClient();
  const calendar = google.calendar({ version: 'v3', auth });

  const result = await calendar.events.patch({
    calendarId: payload.calendarId || 'primary',
    eventId: payload.eventId,
    requestBody: {
      summary: payload.summary
    },
    sendUpdates: 'none'
  });

  return {
    id: result.data.id,
    summary: result.data.summary || ''
  };
});


function fetchUrl(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error('리다이렉트가 너무 많음'));
      return;
    }

    https.get(url, (res) => {
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

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

ipcMain.handle('calendar:fetchICS', async (_, icsUrl) => {
  return await fetchUrl(icsUrl);
});

ipcMain.handle('calendar:listEvents', async () => {
  const auth = await getAuthorizedClient();
  const calendar = google.calendar({ version: 'v3', auth });

  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  const oneYearLater = new Date();
  oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);

  const [eventsResult, colorsResult] = await Promise.all([
    calendar.events.list({
      calendarId: 'primary',
      timeMin: oneYearAgo.toISOString(),
      timeMax: oneYearLater.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 1000
    }),
    calendar.colors.get()
  ]);

  const eventColors = colorsResult.data.event || {};
  const items = eventsResult.data.items || [];

  return items.map(event => {
    const startValue = event.start?.dateTime || event.start?.date;
    const endValue = event.end?.dateTime || event.end?.date || startValue;

    const colorInfo = event.colorId ? eventColors[event.colorId] : null;

    return {
      id: event.id,
      summary: event.summary || '(제목 없음)',
      description: event.description || '',
      location: event.location || '',
      start: startValue,
      end: endValue,
      colorId: event.colorId || null,
      color: colorInfo?.background || '#60a5fa',
      htmlLink: event.htmlLink || ''
    };

  });
});

ipcMain.on("resize-window", (event, { width, height }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;

  const bounds = win.getBounds();

  win.setBounds({
    x: bounds.x,
    y: bounds.y,
    width: Math.max(240, Math.round(width)),
    height: Math.max(360, Math.round(height))
  });
});
