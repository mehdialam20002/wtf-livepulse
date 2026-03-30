const { WebSocketServer } = require("ws");

let wss;

function initWebSocketServer(server) {
  wss = new WebSocketServer({ server });

  wss.on("connection", (socket) => {
    socket.send(
      JSON.stringify({
        type: "WS_CONNECTED",
        timestamp: new Date().toISOString(),
      })
    );
  });

  return wss;
}

function broadcast(event) {
  if (!wss) {
    return;
  }

  const payload = JSON.stringify(event);

  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }
}

module.exports = {
  initWebSocketServer,
  broadcast,
};
