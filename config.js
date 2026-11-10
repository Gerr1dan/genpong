// Public MQTT-over-WebSocket brokers used to relay moves between two players (tried in order).
// Only game moves travel through them (throw speed/direction and results), under a random 4-letter room code.
window.GENPONG_CONFIG = {
  brokers: ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'],
};
