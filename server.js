
import express from 'express';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { TikTokLive, label } from 'ttl-live';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({
  server,
  path: '/events'
});

const PORT = process.env.PORT || 10000;
const MAX_EVENTS = 100;
const events = [];

let live = null;
let liveConnected = false;
let connecting = false;
let currentUsername = null;

app.use(express.static('public'));

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    connected: liveConnected,
    username: currentUsername,
    clients: wss.clients.size
  });
});

app.get('/api/events', (req, res) => {
  res.json(events);
});

app.post('/api/connect', express.json(), async (req, res) => {
  const username = String(req.body?.username || '')
    .trim()
    .replace(/^@/, '');

  if (!/^[a-zA-Z0-9._]{1,24}$/.test(username)) {
    return res.status(400).json({
      error: 'Enter a valid TikTok username.'
    });
  }

  if (connecting) {
    return res.status(409).json({
      error: 'A connection attempt is already running.'
    });
  }

  if (live && currentUsername === username) {
    return res.json({
      message: 'Already connected or connecting.',
      username
    });
  }

  connecting = true;
  liveConnected = false;

  try {
    if (live) {
      try {
        await live.disconnect();
      } catch (e) {
        console.error('Previous disconnect:', e.message);
      }
    }

    currentUsername = username;
    live = new TikTokLive(`@${username}`);

    const client = live;

    const publish = (type, data) => {
      const item = {
        id: `${Date.now()}-${Math.random()}`,
        type,
        username,
        timestamp: new Date().toISOString(),
        data
      };

      events.unshift(item);
      if (events.length > MAX_EVENTS) events.pop();

      const message = JSON.stringify(item);

      for (const ws of wss.clients) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
        }
      }

      console.log(`[${type}]`, JSON.stringify(data).slice(0, 300));
    };

    for (const type of [
      'chat',
      'gift',
      'like',
      'member',
      'social',
      'roomUser',
      'unknown'
    ]) {
      client.on(type, data => publish(type, data));
    }

    client.on('error', error => {
      console.error('TikTok error:', error);
      publish('error', {
        message: error?.message || String(error)
      });
    });

    // Return the HTTP response promptly.
    res.json({
      message: 'Connection started.',
      username
    });

    await client.connect();
    liveConnected = true;

    publish('status', { connected: true });
  } catch (error) {
    liveConnected = false;
    console.error('Connection failed:', error);

    publish('status', {
      connected: false,
      message: error?.message || String(error)
    });
  } finally {
    connecting = false;
  }
});

wss.on('connection', ws => {
  ws.send(JSON.stringify({
    type: 'initial',
    connected: liveConnected,
    username: currentUsername,
    events
  }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
