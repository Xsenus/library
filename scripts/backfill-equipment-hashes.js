#!/usr/bin/env node
const { Pool } = require('pg');
const crypto = require('node:crypto');

const pool = new Pool({
  host: process.env.PGHOST,
  port: parseInt(process.env.PGPORT || '5432', 10),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: false,
});

const HASH_LENGTH = parseInt(process.env.EQUIPMENT_HASH_LENGTH || '32', 10);

function generateHash() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  const bytes = crypto.randomBytes(HASH_LENGTH);
  let result = '';
  for (let i = 0; i < HASH_LENGTH; i += 1) {
    result += alphabet[bytes[i] % alphabet.length];
  }
  return result;
}

async function fetchExistingHashes(client) {
  const res = await client.query(
    `SELECT hash_equipment FROM ib_equipment WHERE hash_equipment IS NOT NULL AND length(trim(hash_equipment)) > 0`,
  );
  return new Set(res.rows.map((row) => row.hash_equipment));
}

async function fetchRowsToUpdate(client) {
  const res = await client.query(
    `SELECT id FROM ib_equipment WHERE hash_equipment IS NULL OR length(trim(hash_equipment)) = 0 ORDER BY id`,
  );
  return res.rows.map((row) => row.id);
}

async function backfill() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await fetchExistingHashes(client);
    const rows = await fetchRowsToUpdate(client);

    if (rows.length === 0) {
      await client.query('COMMIT');
      console.log('Все записи уже имеют заполненный hash_equipment.');
      return;
    }

    console.log(`Найдено записей для обновления: ${rows.length}`);

    for (const id of rows) {
      let hash;
      do {
        hash = generateHash();
      } while (existing.has(hash));
      existing.add(hash);
      await client.query('UPDATE ib_equipment SET hash_equipment = $1 WHERE id = $2', [hash, id]);
    }

    await client.query('COMMIT');
    console.log('Хэши успешно сгенерированы и сохранены.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Ошибка при генерации хэшей:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

backfill().catch((error) => {
  console.error('Непредвиденная ошибка:', error);
  process.exitCode = 1;
});
