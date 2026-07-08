import { WebSocketServer } from "ws";
import { pool } from "./db.js";
import {
  appendUserMessage,
  getCouncilStatus,
  getMessages,
  onCouncilEvent,
  runCouncilRoundForRace,
  startCouncilSession,
  stopCouncilSession,
} from "./lib/councilService.js";

function parseRaceQuery(urlString = "") {
  try {
    const u = new URL(urlString, "http://localhost");
    const meetingDate = String(u.searchParams.get("meeting_date") ?? "").trim();
    const venueCode = String(u.searchParams.get("venue_code") ?? "").trim();
    const raceNo = Number(u.searchParams.get("race_no") ?? "0");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(meetingDate)) return null;
    if (!venueCode) return null;
    if (!Number.isFinite(raceNo) || raceNo < 1) return null;
    return { meeting_date: meetingDate, venue_code: venueCode, race_no: raceNo };
  } catch {
    return null;
  }
}

function send(ws, type, payload = {}) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify({ type, ...payload }));
}

async function loadUserBySessionUserId(userId) {
  const { rows } = await pool.query("SELECT id, username, role FROM dashboard_users WHERE id = $1", [userId]);
  return rows[0] ?? null;
}

export function attachCouncilWs({ server, sessionMiddleware }) {
  const wss = new WebSocketServer({ noServer: true });
  const fakeRes = {
    getHeader() {
      return undefined;
    },
    setHeader() {},
    end() {},
    writeHead() {},
  };

  server.on("upgrade", (req, socket, head) => {
    if (!req.url?.startsWith("/ws/council")) return;
    sessionMiddleware(req, fakeRes, async () => {
      try {
        const userId = req.session?.userId;
        if (!userId) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }
        const user = await loadUserBySessionUserId(userId);
        if (!user) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }
        req.user = user;
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit("connection", ws, req);
        });
      } catch {
        socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
        socket.destroy();
      }
    });
  });

  wss.on("connection", async (ws, req) => {
    const race = parseRaceQuery(req.url ?? "");
    if (!race) {
      send(ws, "error", { message: "Invalid race query" });
      ws.close();
      return;
    }
    const user = req.user;

    const pushInit = async () => {
      const status = await getCouncilStatus({
        meetingDate: race.meeting_date,
        venueCode: race.venue_code,
        raceNo: race.race_no,
      });
      const messages = await getMessages({
        meetingDate: race.meeting_date,
        venueCode: race.venue_code,
        raceNo: race.race_no,
        sessionId: status.active_session?.session_id ?? null,
        afterSeq: 0,
      });
      send(ws, "session_state", {
        race,
        status,
        user,
      });
      send(ws, "messages_sync", {
        items: messages,
      });
    };

    await pushInit();

    const off = onCouncilEvent((ev) => {
      const p = ev.payload ?? {};
      if (
        p.meeting_date !== race.meeting_date ||
        p.venue_code !== race.venue_code ||
        Number(p.race_no) !== Number(race.race_no)
      ) {
        if (ev.type !== "date_activation" || p.meeting_date !== race.meeting_date) return;
      }
      if (ev.type === "stage_event") return send(ws, "stage_event", p);
      if (ev.type === "agent_message") return send(ws, "agent_message", p);
      if (ev.type === "picks_update") return send(ws, "picks_update", p);
      if (ev.type === "typing_update") return send(ws, "typing_update", p);
      if (ev.type === "cadence_update") return send(ws, "cadence_update", p);
      if (ev.type === "round_gap_update") return send(ws, "round_gap_update", p);
      if (ev.type === "session_state") return send(ws, "session_state", p);
      if (ev.type === "date_activation") return send(ws, "date_activation", p);
    });

    ws.on("message", async (raw) => {
      try {
        const m = JSON.parse(String(raw ?? "{}"));
        const type = String(m.type ?? "");
        if (type === "start") {
          await startCouncilSession({
            meetingDate: race.meeting_date,
            venueCode: race.venue_code,
            raceNo: race.race_no,
            trigger: "manual",
            userId: user.id,
          });
          runCouncilRoundForRace({
            meetingDate: race.meeting_date,
            venueCode: race.venue_code,
            raceNo: race.race_no,
            force: true,
            trigger: "ws_start",
          }).catch((e) => console.error("[ws/start round]", e));
          return;
        }
        if (type === "stop") {
          await stopCouncilSession({
            meetingDate: race.meeting_date,
            venueCode: race.venue_code,
            raceNo: race.race_no,
            reason: "manual_stop",
          });
          return;
        }
        if (type === "user_message") {
          const content = String(m.content ?? "").trim();
          if (!content) return;
          await appendUserMessage({
            meetingDate: race.meeting_date,
            venueCode: race.venue_code,
            raceNo: race.race_no,
            userId: user.id,
            username: user.username,
            content,
          });
          runCouncilRoundForRace({
            meetingDate: race.meeting_date,
            venueCode: race.venue_code,
            raceNo: race.race_no,
            force: true,
            trigger: "ws_message",
          }).catch((e) => console.error("[ws/message round]", e));
          return;
        }
      } catch (e) {
        send(ws, "error", { message: e?.message ?? String(e) });
      }
    });

    ws.on("close", () => {
      off();
    });
  });
}

