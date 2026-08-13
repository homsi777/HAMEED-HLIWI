import { Global, Inject, Injectable, Module, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { appConfig } from '../config/app-config.js';
import * as schema from './schema.js';

export const DATABASE = Symbol('DATABASE');
export type Database = ReturnType<typeof drizzle<typeof schema>>;

@Injectable()
export class DatabaseLifecycle implements OnModuleInit, OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly db: Database, @Inject('SQL_CLIENT') private readonly sql: postgres.Sql) {}
  async onModuleInit() { await this.sql`select 1`; }
  async onApplicationShutdown() { await this.sql.end({ timeout: 5 }); }
}

@Global()
@Module({
  providers: [
    { provide: 'SQL_CLIENT', useFactory: () => {
      const config = appConfig();
      return postgres(config.databaseUrl, { max: config.databasePoolMax, idle_timeout: 20, connect_timeout: 10 });
    } },
    { provide: DATABASE, inject: ['SQL_CLIENT'], useFactory: (sql: postgres.Sql) => drizzle(sql, { schema }) },
    DatabaseLifecycle,
  ],
  exports: [DATABASE, 'SQL_CLIENT'],
})
export class DatabaseModule {}
