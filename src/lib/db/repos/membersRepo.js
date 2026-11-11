import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

function rowToMember(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name || null,
    email: row.email || null,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
  };
}

export async function getMembers() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM members ORDER BY createdAt ASC`);
  return rows.map(rowToMember);
}

export async function getMemberById(id) {
  if (!id) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM members WHERE id = ?`, [id]);
  return rowToMember(row);
}

export async function getMemberByEmail(email) {
  if (!email) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM members WHERE email = ?`, [String(email).trim().toLowerCase()]);
  return rowToMember(row);
}

export async function createMember({ name, email }) {
  const cleanName = typeof name === "string" ? name.trim() : "";
  const cleanEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!cleanEmail) throw new Error("email is required");
  const db = await getAdapter();
  const member = {
    id: uuidv4(),
    name: cleanName || null,
    email: cleanEmail,
    isActive: true,
    createdAt: new Date().toISOString(),
  };
  db.run(
    `INSERT INTO members(id, name, email, isActive, createdAt) VALUES(?, ?, ?, ?, ?)`,
    [member.id, member.name, member.email, 1, member.createdAt]
  );
  return member;
}

export async function updateMember(id, data = {}) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM members WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToMember(row), ...data };
    db.run(`UPDATE members SET name = ?, email = ?, isActive = ? WHERE id = ?`, [
      merged.name || null,
      merged.email ? String(merged.email).trim().toLowerCase() : null,
      merged.isActive ? 1 : 0,
      id,
    ]);
    result = rowToMember(db.get(`SELECT * FROM members WHERE id = ?`, [id]));
  });
  return result;
}
