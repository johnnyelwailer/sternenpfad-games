// Local PeerJS signaling server for development and e2e tests.
// The published game uses the free public PeerJS cloud by default;
// pass ?ps=host:port to the game URL to use this one instead.
// Usage: node scripts/peer-server.mjs [port]
import { PeerServer } from "peer";

const port = Number(process.argv[2] || 9200);

PeerServer({ port, host: "127.0.0.1", path: "/ff" }, () => {
  console.log(`peer server on http://localhost:${port}/ff`);
});
