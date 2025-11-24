const crypto = require('crypto');
const { Pool: PgPool } = require('pg');
const mysql = require('mysql2/promise');
const mssql = require('mssql');

const connections = new Map();

function mapColumns(rows, opts = {}) {
  const { tableKey = 'table_name', nameKey = 'column_name', typeKey = 'data_type', lengthKey = 'character_maximum_length', scaleKey = 'numeric_scale', nullableKey = 'is_nullable', keyKey = 'column_key', commentKey = 'column_comment' } = opts;
  const schema = {};
  for (const col of rows) {
    const tableName = col[tableKey] || col.table_name;
    if (!schema[tableName]) schema[tableName] = [];
    schema[tableName].push({
      name: col[nameKey] || col.column_name,
      type: (col[typeKey] || '').toString().toUpperCase(),
      length: col[lengthKey] ? Number(col[lengthKey]) : undefined,
      decimal: col[scaleKey] ? Number(col[scaleKey]) : undefined,
      notNull: (col[nullableKey] || '').toString().toUpperCase() === 'NO',
      virtual: false,
      isKey: (col[keyKey] || '').includes('PRI') || (col[keyKey] || '').toLowerCase().includes('primary'),
      comment: col[commentKey] || '',
    });
  }
  return schema;
}

async function connect(config) {
  const id = crypto.randomUUID();
  const base = { id, name: config.name, type: config.type, host: config.host, database: config.database };

  if (config.type === 'mysql') {
    const pool = mysql.createPool({
      host: config.host,
      port: config.port || 3306,
      user: config.user,
      password: config.password,
      database: config.database || undefined,
      waitForConnections: true,
    });
    await pool.query('SELECT 1');
    connections.set(id, { type: 'mysql', pool, config });
    return base;
  }

  if (config.type === 'postgres') {
    const pool = new PgPool({
      host: config.host,
      port: config.port || 5432,
      user: config.user,
      password: config.password,
      database: config.database || 'postgres',
    });
    await pool.query('SELECT 1');
    connections.set(id, { type: 'postgres', pool, config });
    return base;
  }

  if (config.type === 'sqlserver') {
    const pool = new mssql.ConnectionPool({
      user: config.user,
      password: config.password,
      server: config.host,
      port: config.port || 1433,
      database: config.database || 'master',
      options: {
        encrypt: false,
        trustServerCertificate: true,
      },
    });
    await pool.connect();
    connections.set(id, { type: 'sqlserver', pool, config });
    return base;
  }

  throw new Error(`暂不支持的数据库类型: ${config.type}`);
}

async function listSchema(connId, database) {
  const conn = connections.get(connId);
  if (!conn) throw new Error('连接不存在');

  if (conn.type === 'mysql') {
    if (!database) {
      const [dbs] = await conn.pool.query('SHOW DATABASES');
      const databases = dbs.map((d) => ({
        id: `${connId}-${d.Database}`,
        name: d.Database,
        expanded: false,
        tablesExpanded: false,
        viewsExpanded: false,
        tables: [],
        views: [],
        loaded: false,
      }));
      return { databases, schema: {} };
    }
    const mysqlConn = await conn.pool.getConnection();
    try {
      await mysqlConn.query(`USE \`${database}\``);
      const [tables] = await mysqlConn.query('SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.tables WHERE table_schema = ?', [database]);
      const [columns] = await mysqlConn.query(
        'SELECT TABLE_NAME as table_name, COLUMN_NAME as column_name, DATA_TYPE as data_type, CHARACTER_MAXIMUM_LENGTH as character_maximum_length, NUMERIC_SCALE as numeric_scale, IS_NULLABLE as is_nullable, COLUMN_KEY as column_key, COLUMN_COMMENT as column_comment FROM information_schema.columns WHERE table_schema = ?',
        [database]
      );
      const schema = mapColumns(columns);
      const dbNode = {
        id: `${connId}-${database}`,
        name: database,
        expanded: true,
        tablesExpanded: true,
        viewsExpanded: true,
        tables: tables.filter((t) => t.TABLE_TYPE !== 'VIEW').map((t) => t.TABLE_NAME),
        views: tables.filter((t) => t.TABLE_TYPE === 'VIEW').map((t) => t.TABLE_NAME),
        loaded: true,
      };
      return { databases: [dbNode], schema };
    } finally {
      mysqlConn.release();
    }
  }

  if (conn.type === 'postgres') {
    if (!database) {
      const client = await conn.pool.connect();
      try {
        const dbs = await client.query(`SELECT datname FROM pg_database WHERE datistemplate = false AND datallowconn = true`);
        const databases = dbs.rows.map((d) => ({
          id: `${connId}-${d.datname}`,
          name: d.datname,
          expanded: false,
          tablesExpanded: false,
          viewsExpanded: false,
          tables: [],
          views: [],
          loaded: false,
        }));
        return { databases, schema: {} };
      } finally {
        client.release();
      }
    }
    const tempPool = new PgPool({
      host: conn.config.host,
      port: conn.config.port || 5432,
      user: conn.config.user,
      password: conn.config.password,
      database,
    });
    const client = await tempPool.connect();
    try {
      const tables = await client.query(`SELECT table_schema, table_name, table_type FROM information_schema.tables WHERE table_schema NOT IN ('information_schema','pg_catalog') ORDER BY table_name`);
      const columns = await client.query(`SELECT table_schema, table_name, column_name, data_type, character_maximum_length, numeric_scale, is_nullable FROM information_schema.columns WHERE table_schema NOT IN ('information_schema','pg_catalog')`);
      const schema = mapColumns(columns.rows, { tableKey: 'table_name', nameKey: 'column_name', typeKey: 'data_type', lengthKey: 'character_maximum_length', scaleKey: 'numeric_scale', nullableKey: 'is_nullable' });
      const dbNode = {
        id: `${connId}-${database}`,
        name: database,
        expanded: true,
        tablesExpanded: true,
        viewsExpanded: true,
        tables: tables.rows.filter((t) => t.table_type !== 'VIEW').map((t) => t.table_name),
        views: tables.rows.filter((t) => t.table_type === 'VIEW').map((t) => t.table_name),
        loaded: true,
      };
      return { databases: [dbNode], schema };
    } finally {
      client.release();
      await tempPool.end();
    }
  }

  if (conn.type === 'sqlserver') {
    if (!database) {
      const res = await conn.pool.request().query(`SELECT name FROM sys.databases WHERE name NOT IN ('master','tempdb','model','msdb')`);
      const databases = res.recordset.map((d) => ({
        id: `${connId}-${d.name}`,
        name: d.name,
        expanded: false,
        tablesExpanded: false,
        viewsExpanded: false,
        tables: [],
        views: [],
        loaded: false,
      }));
      return { databases, schema: {} };
    }
    const tables = await conn.pool.request().query(`SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE FROM ${database}.INFORMATION_SCHEMA.TABLES`);
    const columns = await conn.pool.request().query(`SELECT TABLE_NAME as table_name, COLUMN_NAME as column_name, DATA_TYPE as data_type, CHARACTER_MAXIMUM_LENGTH as character_maximum_length, NUMERIC_SCALE as numeric_scale, IS_NULLABLE as is_nullable FROM ${database}.INFORMATION_SCHEMA.COLUMNS`);
    const schema = mapColumns(columns.recordset);
    const dbNode = {
      id: `${connId}-${database}`,
      name: database,
      expanded: true,
      tablesExpanded: true,
      viewsExpanded: true,
      tables: tables.recordset.filter((t) => t.TABLE_TYPE !== 'VIEW').map((t) => t.TABLE_NAME),
      views: tables.recordset.filter((t) => t.TABLE_TYPE === 'VIEW').map((t) => t.TABLE_NAME),
      loaded: true,
    };
    return { databases: [dbNode], schema };
  }

  throw new Error(`暂不支持的数据库类型: ${conn.type}`);
}

async function runQuery(connId, sql, database) {
  const conn = connections.get(connId);
  if (!conn) throw new Error('连接不存在');

  if (conn.type === 'mysql') {
    const mysqlConn = await conn.pool.getConnection();
    try {
      if (database) await mysqlConn.query(`USE \`${database}\``);
      const [rows, fields] = await mysqlConn.query(sql);
      const headers = fields ? fields.map((f) => f.name) : (rows[0] ? Object.keys(rows[0]) : []);
      return { headers, rows };
    } finally {
      mysqlConn.release();
    }
  }

  if (conn.type === 'postgres') {
    const tempPool = new PgPool({
      host: conn.config.host,
      port: conn.config.port || 5432,
      user: conn.config.user,
      password: conn.config.password,
      database: database || conn.config.database || 'postgres',
    });
    const client = await tempPool.connect();
    try {
      const res = await client.query(sql);
      const headers = res.fields ? res.fields.map((f) => f.name) : [];
      return { headers, rows: res.rows };
    } finally {
      client.release();
      await tempPool.end();
    }
  }

  if (conn.type === 'sqlserver') {
    const res = await conn.pool.request().query(`${database ? `USE [${database}]; ` : ''}${sql}`);
    const rows = res.recordset || [];
    const headers = fields ? fields.map((f) => f.name) : (rows[0] ? Object.keys(rows[0]) : []);
    return { headers, rows };
  }

  throw new Error(`暂不支持的数据库类型: ${conn.type}`);
}

async function close(connId) {
  const conn = connections.get(connId);
  if (!conn) return;
  if (conn.type === 'mysql') await conn.pool.end();
  if (conn.type === 'postgres') await conn.pool.end();
  if (conn.type === 'sqlserver') await conn.pool.close();
  connections.delete(connId);
}

async function closeAll() {
  for (const [id] of connections) {
    await close(id);
  }
}

module.exports = {
  connect,
  listSchema,
  runQuery,
  close,
  closeAll,
};
