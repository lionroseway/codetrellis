/**
 * Minimal `sql.js` type shim. The official `@types/sql.js` package
 * exists but its API surface lags behind what we use; declaring the
 * subset we touch keeps the typechecker happy without forcing a
 * dependency upgrade.
 *
 * Surface used by `services/database.ts`:
 *   import initSqlJs from 'sql.js';
 *   const SQL = await initSqlJs({ locateFile: () => path });
 *   const db = new SQL.Database();
 *   db.run(sql, params?);
 *   db.exec(sql, params?);  → [{ values: any[][] }] | []
 *   db.export();            → Uint8Array
 */
declare module 'sql.js' {
  export interface Database {
    run(sql: string, params?: unknown[]): void;
    exec(sql: string, params?: unknown[]): Array<{ columns: string[]; values: any[][] }>;
    export(): Uint8Array;
    close(): void;
  }

  export interface SqlJsStatic {
    Database: new (data?: Uint8Array | null) => Database;
  }

  interface InitOptions {
    locateFile?: (file: string) => string;
  }

  export default function initSqlJs(options?: InitOptions): Promise<SqlJsStatic>;
}
