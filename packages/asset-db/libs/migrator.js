"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Migrator = void 0;
const utils_1 = require("./utils");
class Migrator {
    constructor(migrations, lastedVersion, hook) {
        this.migrations = migrations;
        this.lastedVersion = lastedVersion;
        this.hook = hook;
        if (hook === null || hook === void 0 ? void 0 : hook.onError) {
            this.onError = hook.onError;
        }
    }
    async run(data, startVersion, extArgs) {
        var _a, _b;
        if (startVersion === this.lastedVersion) {
            return data;
        }
        if ((_a = this.hook) === null || _a === void 0 ? void 0 : _a.pre) {
            try {
                await this.hook.pre(data);
            }
            catch (error) {
                this.onError(error, 'preMigrate', data, ...(extArgs || []));
            }
        }
        let result = data;
        for (const migration of this.migrations) {
            if ((0, utils_1.compareVersion)(startVersion, migration.version) > 0) {
                continue;
            }
            try {
                console.debug(`Migration: -> ${migration.version}`);
                result = await migration.migrate(result, ...(extArgs || []));
            }
            catch (error) {
                this.onError(error, 'migrate', result, ...(extArgs || []));
            }
        }
        if ((_b = this.hook) === null || _b === void 0 ? void 0 : _b.post) {
            try {
                await this.hook.post(data);
            }
            catch (error) {
                this.onError(error, 'postMigrate', data, ...(extArgs || []));
            }
        }
        return result;
    }
    onError(error, stage, data, ...args) {
        console.error(`Migrate error in ${stage}`);
        console.error(error);
    }
}
exports.Migrator = Migrator;
