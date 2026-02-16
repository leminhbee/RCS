const { WebSocketServer } = require('ws');
const { fetchDashboardData } = require('../controllers/dashboard');
const { createLogger } = require('./logger');

const logger = createLogger('websocket');

let wss = null;

function init(server, dashboardKey) {
  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname !== `/dashboard/${dashboardKey}/ws`) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', async (ws) => {
    logger.info({ clients: wss.clients.size }, 'WebSocket client connected');

    try {
      const data = await fetchDashboardData();
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(data));
      }
    } catch (error) {
      logger.error({ error: error.message }, 'Failed to send initial dashboard data');
    }

    ws.on('close', () => {
      logger.info({ clients: wss.clients.size }, 'WebSocket client disconnected');
    });
  });
}

async function broadcast() {
  if (!wss || wss.clients.size === 0) return;

  try {
    const data = await fetchDashboardData();
    const payload = JSON.stringify(data);

    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) {
        client.send(payload);
      }
    }
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to broadcast dashboard data');
  }
}

module.exports = { init, broadcast };
