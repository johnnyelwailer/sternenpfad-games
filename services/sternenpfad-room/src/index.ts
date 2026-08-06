import { DurableObject } from "cloudflare:workers";

interface Env {
  ROOMS: DurableObjectNamespace<Room>;
}

type Direction = "north" | "east" | "south" | "west";
type Action = "forward" | "turnLeft" | "turnRight";

interface RoomState {
  players: Record<string, { x: number; y: number; direction: Direction }>;
  updatedAt: number;
}

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
};

function json(value: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: { ...jsonHeaders, ...(init?.headers ?? {}) },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ ok: true, service: "sternenpfad-room", protocol: 1 });
    }

    if (url.pathname !== "/room") {
      return json({ error: "not_found" }, { status: 404 });
    }

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return json({ error: "websocket_required" }, { status: 426 });
    }

    const roomId = (url.searchParams.get("room") ?? "demo")
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .slice(0, 32) || "demo";
    const playerId = (url.searchParams.get("player") ?? crypto.randomUUID())
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .slice(0, 48) || crypto.randomUUID();

    const room = env.ROOMS.get(env.ROOMS.idFromName(roomId));
    return room.fetch(request);
  },
};

export class Room extends DurableObject<Env> {
  private state: RoomState = { players: {}, updatedAt: Date.now() };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get<RoomState>("state")) ?? this.state;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const playerId = new URL(request.url).searchParams.get("player") ?? crypto.randomUUID();
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server, [playerId]);
    server.serializeAttachment({ playerId });
    this.state.players[playerId] ??= { x: 0, y: 0, direction: "east" };
    await this.persist();
    server.send(JSON.stringify({ type: "snapshot", state: this.state, playerId }));

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const raw = typeof message === "string" ? message : new TextDecoder().decode(message);
    let parsed: { type?: string; action?: Action };
    try {
      parsed = JSON.parse(raw) as { type?: string; action?: Action };
    } catch {
      return;
    }
    const attachment = ws.deserializeAttachment() as { playerId?: string } | null;
    const playerId = attachment?.playerId;
    const player = playerId ? this.state.players[playerId] : undefined;

    if (!player || parsed.type !== "action" || !parsed.action) return;

    if (parsed.action === "forward") {
      if (player.direction === "north") player.y -= 1;
      if (player.direction === "east") player.x += 1;
      if (player.direction === "south") player.y += 1;
      if (player.direction === "west") player.x -= 1;
    }
    if (parsed.action === "turnLeft") player.direction = turn(player.direction, -1);
    if (parsed.action === "turnRight") player.direction = turn(player.direction, 1);

    await this.persist();
    this.broadcast({ type: "snapshot", state: this.state, playerId, action: parsed.action });
  }

  async webSocketClose(ws: WebSocket) {
    const attachment = ws.deserializeAttachment() as { playerId?: string } | null;
    if (attachment?.playerId) {
      delete this.state.players[attachment.playerId];
      await this.persist();
      this.broadcast({ type: "snapshot", state: this.state });
    }
  }

  private async persist() {
    this.state.updatedAt = Date.now();
    await this.ctx.storage.put("state", this.state);
  }

  private broadcast(value: unknown) {
    const message = JSON.stringify(value);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket.readyState === WebSocket.OPEN) socket.send(message);
    }
  }
}

function turn(direction: Direction, delta: number): Direction {
  const directions: Direction[] = ["north", "east", "south", "west"];
  return directions[(directions.indexOf(direction) + delta + directions.length) % directions.length];
}
