// server.js
// Node 18+ (global fetch). Запуск: `node server.js`
// ENV: PORT=3000 DATA_DIR=./data  (и при желании X_API_KEY для простой авторизации)

import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import crypto, { randomUUID } from 'node:crypto';
import { buildVlessLinkFromServerConfig, chooseBestServer, msExpiryEpochPlusOneDay } from './utils.js';

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.resolve('./data');
const SERVERS_FILE = path.join(DATA_DIR, 'servers.json');
const LOADS_FILE = path.join(DATA_DIR, 'loads.json');

// ---- утилиты JSON ----
async function ensureDir(p) { await fs.mkdir(p, { recursive: true }).catch(() => { }); }
async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf-8')); }
  catch { return fallback; }
}
async function writeJson(file, data) {
  const tmp = file + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  await fs.rename(tmp, file);
}

// ---- конфиги ----
async function getServers() {
  const data = await readJson(SERVERS_FILE, { servers: [] });
  let servers = Array.isArray(data.servers) ? data.servers : [];
  servers = servers.filter(s => s.enabled !== false);
  return servers;
}
async function getLoads() {
  const data = await readJson(LOADS_FILE, { loads: {} });
  return (data && typeof data.loads === 'object') ? data.loads : {};
}

const getLoginCookies = async (server) => {
  try {
    const loginUrl = new URL(`/${server.webBasePath}/login`, server.apiUrl).toString();

    // console.log(loginUrl)

    const form = new URLSearchParams({
      username: server.username,
      password: server.password,
    });

    const loginRes = await fetch(loginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      redirect: 'manual',
    });

    const setCookie = loginRes.headers.get('set-cookie');
    if (!setCookie || (!loginRes.ok && loginRes.status !== 302)) {
      throw new Error(`3x-ui login failed: ${loginRes.status}`);
    }

    return setCookie;
  } catch (err) {
    console.error(err);
    return null;
  }

}

const addClient = async (server, inboundId, clientObj, loginCookie) => {
  try {
    const addClientUrl = new URL(`/${server.webBasePath}/panel/api/inbounds/addClient`, server.apiUrl).toString();

    const addRes = await fetch(addClientUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': loginCookie },
      body: JSON.stringify({
        id: inboundId,
        settings: JSON.stringify({ clients: [clientObj] }),
      }),
    });

    if (!addRes.ok) {
      throw new Error(`3x-ui addClient failed`);
    }
    return addRes;
  } catch (err) {
    console.error(err);
    return null;
  }
};

const getInboundsOfServer = async (server, loginCookie) => {
  try {
    const getInboundUrl = new URL(`/${server.webBasePath}/panel/api/inbounds/list`, server.apiUrl).toString();

    const res = await fetch(getInboundUrl, {
      method: 'GET',
      headers: { 'Cookie': loginCookie },
    });


    if (!res.ok) {
      throw new Error(`3x-ui getInbound failed`);
    }

    const result = await res.json();

    return result;
  } catch (err) {
    console.error(err);
    return null;
  }

}

// ---- адаптер: 3x-ui / x-ui (получаем VLESS из ответа панели) ----
async function createKey3xui(server, { inboundId, clientName, months }) {
  try {
    // 1) login
    const loginCookie = await getLoginCookies(server);

    // 2) add client
    const id = crypto.randomUUID();
    const expireAtEpoch = msExpiryEpochPlusOneDay(months);
    const clientObj = {
      id,
      email: clientName,
      flow: '',
      totalGB: 0,
      expiryTime: expireAtEpoch, // в миллисекундах
      enable: true,
    };

    // 3) add client
    const addRes = await addClient(server, inboundId, clientObj, loginCookie);

    // 4) build VLESS link
    const vless = buildVlessLinkFromServerConfig(server, { id, clientName })

    if (!vless) {
      // Если панель не вернула ссылку — считаем это ошибкой (пусть фейловер попробует другой сервер)
      throw new Error('Failed to build VLESS link from server config');
    }

    return {
      vless
    };
  } catch (err) {
    console.error(err);
    return null;
  }


}

// ---- Express ----
const app = express();
app.use(express.json());

// health
app.get('/health', (_, res) => res.json({ ok: true }));

// список серверов без секретов
app.get('/servers', async (_, res) => {
  const servers = await getServers();

  const serversObj = servers.map(s => ({
    id: s.id
  }))

  res.json({ servers: serversObj });
});

// текущие нагрузки
app.get('/loads', async (_, res) => {
  const servers = await getServers();

  const loads = {};

  await Promise.all(servers.map(async (server) => {
    const loginCookies = await getLoginCookies(server);

    const inboundsRes = await getInboundsOfServer(server, loginCookies);

    loads[server.id] = inboundsRes.obj.reduce((acc, inbound) => {
      if (inbound?.clientStats?.length) {
        return { ...acc, [inbound.remark]: inbound.clientStats.length }
      }
    }, {});
  }));

  res.json(loads)
});

// app.get('/all-clients', async (_, res) => {
//   const servers = await getServers();
// });

// Выдать ключ (эндпоинт для PuzzleBot): POST /issue-key { clientName, months }
app.get('/get-key', async (req, res) => {
  try {
    const servers = await getServers();

    const serversWithIdsAndLoads = [];

    await Promise.all(servers.map(async (server) => {
      const loginCookies = await getLoginCookies(server);

      const inboundsRes = await getInboundsOfServer(server, loginCookies);

      serversWithIdsAndLoads.push({
        id: server.id,
        currentUsers: inboundsRes.obj.reduce((acc, inbound) => {
          if (inbound?.clientStats?.length) {
            return acc + inbound.clientStats.length
          }
        }, 0),
        usersLimit: server.usersLimit,
        firstInboundId: inboundsRes.obj[0]?.id || null,
      })
    }));

    const bestServer = chooseBestServer(serversWithIdsAndLoads);
    const bestServerInfo = servers.find(s => s.id === chooseBestServer(serversWithIdsAndLoads)?.id);

    // console.log(bestServer);

    if (!bestServer) {
      return res.status(503).json({ error: 'No available servers' });
    }

    const vlessObj = await createKey3xui(bestServerInfo, { inboundId: bestServer.firstInboundId, clientName: randomUUID(), months: +req.query.period || 1 });

    res.json(vlessObj);
  } catch (err) {
    console.error(err);
  }
})

http.createServer(app).listen(PORT, () => {
  console.log(`PuzzleBot bridge listening on http://0.0.0.0:${PORT}`);
});
