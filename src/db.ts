// src/db.ts
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized:false } : undefined,
});

/* ---------------- INIT ---------------- */
export async function initDB() {
  await pool.query(`SELECT 1`);
}

/* ---------------- USERS ---------------- */
export async function upsertUser({ uid, username }: { uid:string, username:string }) {
  const { rows } = await pool.query(`
    INSERT INTO users (uid, username, updated_at)
    VALUES ($1,$2,NOW())
    ON CONFLICT (uid)
    DO UPDATE SET username=EXCLUDED.username, updated_at=NOW()
    RETURNING *
  `,[uid,username]);
  return rows[0];
}

export async function getUserByUid(uid:string){
  const { rows } = await pool.query(`SELECT * FROM users WHERE uid=$1`,[uid]);
  return rows[0]||null;
}

/* ---------------- ONLINE TOUCH ---------------- */
export async function touchUserOnline(uid:string){
  await pool.query(`
    INSERT INTO sessions (uid, session_id, last_seen_at)
    VALUES ($1,'auto',NOW())
    ON CONFLICT (uid)
    DO UPDATE SET last_seen_at=NOW()
  `,[uid]);
}

/* ---------------- SESSIONS ---------------- */
export async function startSession({ uid, sessionId, userAgent, ip }:{
  uid:string, sessionId:string, userAgent:string, ip:string
}){
  const { rows } = await pool.query(`
    INSERT INTO sessions (uid, session_id, user_agent, ip, started_at, last_seen_at)
    VALUES ($1,$2,$3,$4,NOW(),NOW())
    ON CONFLICT (uid)
    DO UPDATE SET last_seen_at=NOW(), session_id=$2
    RETURNING *
  `,[uid,sessionId,userAgent,ip]);
  return rows[0];
}

export async function pingSession(uid:string, sessionId:string){
  const { rows } = await pool.query(`
    UPDATE sessions SET last_seen_at=NOW()
    WHERE uid=$1
    RETURNING *
  `,[uid]);
  return rows[0];
}

export async function endSession(uid:string, sessionId:string){
  const { rows } = await pool.query(`
    DELETE FROM sessions WHERE uid=$1 RETURNING *
  `,[uid]);
  return rows[0];
}

/* ---------------- ADMIN ONLINE ---------------- */
export async function adminListOnlineUsers({ minutes, limit, offset }:{
  minutes:number, limit:number, offset:number
}){
  const { rows } = await pool.query(`
    SELECT u.uid,u.username,u.coins,s.last_seen_at,s.started_at,s.user_agent
    FROM sessions s
    JOIN users u ON u.uid=s.uid
    WHERE s.last_seen_at > NOW() - ($1 || ' minutes')::interval
    ORDER BY s.last_seen_at DESC
    LIMIT $2 OFFSET $3
  `,[minutes,limit,offset]);

  return { ok:true, rows, count:rows.length };
}