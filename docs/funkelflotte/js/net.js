// Peer-to-peer connection for two-device play, built on PeerJS
// (WebRTC; the free public PeerJS cloud is only used to introduce
// the two browsers to each other — game data flows peer to peer).

const PREFIX = "funkelflotte-v2-";
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

export function makeCode(len = 4) {
  let code = "";
  const rand = new Uint32Array(len);
  crypto.getRandomValues(rand);
  for (let i = 0; i < len; i += 1) {
    code += CODE_ALPHABET[rand[i] % CODE_ALPHABET.length];
  }
  return code;
}

export function normalizeCode(raw) {
  return (raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/0/g, "O");
}

// Stable per-device identity so friends can reconnect without codes.
// It doubles as a PeerJS address (host(stableId()) makes this device
// reachable by anyone who played with it before).
export function stableId() {
  try {
    let id = localStorage.getItem("ff-pid");
    if (!id || id.length < 8) {
      id = makeCode(10);
      localStorage.setItem("ff-pid", id);
    }
    return id;
  } catch {
    return makeCode(10);
  }
}

// Optional custom signaling server via ?ps=host:port (used by the
// e2e tests and by anyone self-hosting `scripts/peer-server.mjs`).
export function customServer() {
  const ps = new URLSearchParams(window.location.search).get("ps");
  if (!ps) return null;
  const [host, port] = ps.split(":");
  if (!host) return null;
  return { host, port: Number(port || 443), path: "/ff", secure: host !== "localhost" && host !== "127.0.0.1" };
}

function createPeer(id) {
  const opts = {
    debug: 1,
    config: {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    },
  };
  const custom = customServer();
  if (custom) Object.assign(opts, custom);
  // Without a custom server, the free public PeerJS cloud broker is used.
  return new Peer(id, opts);
}

export class Net {
  constructor() {
    this.peer = null;
    this.conn = null;
    this.onMessage = () => {};
    this.onStatus = () => {};
    this.onClose = () => {};
    this.closed = false;
  }

  host(code) {
    return new Promise((resolve, reject) => {
      this.peer = createPeer(PREFIX + code);
      this.peer.on("open", () => {
        this.onStatus("waiting");
        resolve(code);
      });
      this.peer.on("connection", (conn) => {
        if (this.conn) {
          conn.close();
          return;
        }
        this._wire(conn);
      });
      this.peer.on("error", (err) => {
        if (err.type === "unavailable-id") {
          reject(new Error("code-taken"));
        } else if (!this.conn) {
          reject(err);
        }
      });
    });
  }

  join(code) {
    return new Promise((resolve, reject) => {
      this.peer = createPeer(null);
      const timeout = setTimeout(() => reject(new Error("timeout")), 20000);
      this.peer.on("open", () => {
        const conn = this.peer.connect(PREFIX + code, { reliable: true });
        this._wire(conn, () => {
          clearTimeout(timeout);
          resolve();
        });
      });
      this.peer.on("error", (err) => {
        clearTimeout(timeout);
        if (err.type === "peer-unavailable") reject(new Error("not-found"));
        else reject(err);
      });
    });
  }

  _wire(conn, onOpen) {
    this.conn = conn;
    conn.on("open", () => {
      this.onStatus("connected");
      if (onOpen) onOpen();
    });
    conn.on("data", (data) => {
      if (data && typeof data === "object") this.onMessage(data);
    });
    conn.on("close", () => {
      if (!this.closed) this.onClose();
    });
    conn.on("error", () => {
      if (!this.closed) this.onClose();
    });
  }

  send(msg) {
    if (this.conn && this.conn.open) {
      this.conn.send(msg);
      return true;
    }
    return false;
  }

  destroy() {
    this.closed = true;
    try {
      if (this.conn) this.conn.close();
      if (this.peer) this.peer.destroy();
    } catch {
      /* ignore */
    }
    this.conn = null;
    this.peer = null;
  }
}

export function joinUrl(code) {
  const url = new URL(window.location.href);
  const ps = new URLSearchParams(window.location.search).get("ps");
  url.search = "";
  url.hash = "";
  url.searchParams.set("join", code);
  if (ps) url.searchParams.set("ps", ps); // keep self-hosted signaling server
  return url.toString();
}
