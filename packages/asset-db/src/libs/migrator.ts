import { compareVersion } from './utils';

export type MigrateStage = 'migrate' | 'preMigrate' | 'postMigrate';

export interface Migrate<T> {
    version: string;
    migrate: (data: T, ...args: any[]) => Promise<T>;
}

export interface MigrateHook<T> {
    pre?: (data: T, ...args: any[]) => Promise<T>;
    post?: (data: T, ...args: any[]) => Promise<T>;
    onError?: (error: Error, stage: MigrateStage, data: T, ...args: any[]) => void;
}

export class Migrator<T> {
    private migrations: Migrate<T>[];
    private hook?: MigrateHook<T>;
    private lastedVersion: string;

    constructor(migrations: Migrate<T>[], lastedVersion: string, hook?: MigrateHook<T>) {
        this.migrations = migrations;
        this.lastedVersion = lastedVersion;
        this.hook = hook;
        if (hook?.onError) {
            this.onError = hook.onError;
        }
    }

    async run(data: T, startVersion: string, extArgs?: any[]): Promise<T> {
        if (startVersion === this.lastedVersion) {
            return data;
        }

        if (this.hook?.pre) {
            try {
                await this.hook.pre(data);
            } catch (error) {
                this.onError(error as Error, 'preMigrate', data, ...(extArgs || []));
            }
        }

        let result = data;
        for (const migration of this.migrations) {
            if (compareVersion(startVersion, migration.version) > 0) {
                continue;
            }
            try {
                console.debug(`Migration: -> ${migration.version}`);
                result = await migration.migrate(result, ...(extArgs || []));
            } catch (error) {
                this.onError(error as Error, 'migrate', result, ...(extArgs || []));
            }
        }

        if (this.hook?.post) {
            try {
                await this.hook.post(data);
            } catch (error) {
                this.onError(error as Error, 'postMigrate', data, ...(extArgs || []));
            }
        }

        return result;
    }

    private onError(error: Error, stage: MigrateStage, data: T, ...args: any[]) {
        console.error(`Migrate error in ${stage}`);
        console.error(error);
    }
}
