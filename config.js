// Public MQTT-over-WebSocket brokers used to relay moves between players (tried in order).
// Only game data travels through them (throws, results, names, tournament state), under random room codes.
window.GENPONG_CONFIG = {
  brokers: ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'],
  // SHA-256 of the organizer passphrase needed to create a tournament. This is a speed bump, not real security:
  // the check runs in the browser. Change it by putting a new hash here (e.g. printf 'phrase' | sha256sum).
  organizerHash: 'bc1bda31b00c9e559a2bcda760135248a029096a47d06de2901b6b2767eb070e',
  // Intro video shown once per browser (with a Skip button). Set to a file in this repo, e.g. 'media/intro.mp4'.
  introVideo: null,
};
