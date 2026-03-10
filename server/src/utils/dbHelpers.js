import { db } from '../config/database.js';

function getInsertedId(result) {
  if (Array.isArray(result)) {
    const first = result[0];

    if (typeof first === 'object' && first !== null) {
      return first.id ?? first.insertId;
    }

    return first;
  }

  if (typeof result === 'object' && result !== null) {
    return result.id ?? result.insertId;
  }

  return result;
}

export async function insertAndFetch(tableName, payload) {
  const result = await db(tableName).insert(payload);
  const id = getInsertedId(result);

  return db(tableName).where({ id }).first();
}

export async function updateAndFetch(tableName, where, updates) {
  await db(tableName).where(where).update(updates);
  return db(tableName).where(where).first();
}
