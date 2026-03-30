const { startSimulator } = require("../services/simulatorService");

function bootSimulator() {
  startSimulator(1);
}

module.exports = { bootSimulator };
