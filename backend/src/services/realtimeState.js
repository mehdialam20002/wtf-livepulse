const realtimeState = {
  simulator: {
    running: true,
    speed: 1,
  },
  recentEvents: [],
};

function pushEvent(event) {
  realtimeState.recentEvents.unshift(event);
  realtimeState.recentEvents = realtimeState.recentEvents.slice(0, 20);
}

module.exports = {
  realtimeState,
  pushEvent,
};
