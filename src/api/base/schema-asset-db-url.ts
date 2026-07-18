import { z } from 'zod';
import { pathToDbUrlIfAssetDBPath } from '../../core/assets/asset-db-url';
import type { AssetDBPathInfo } from '../../core/assets/asset-db-url';
import { SchemaSubAssetUUID, SchemaUUID, SchemaUrl } from './schema-identifier';

type GlobalWithAssetDBManager = typeof globalThis & {
    assetDBManager?: {
        assetDBInfo?: Record<string, AssetDBPathInfo>;
    };
};

function getAssetDBInfo(): Record<string, AssetDBPathInfo> {
    return (globalThis as GlobalWithAssetDBManager).assetDBManager?.assetDBInfo ?? {};
}

export function normalizeAssetDbUrlInput(value: string): string {
    return pathToDbUrlIfAssetDBPath(value.trim(), getAssetDBInfo());
}

export const SchemaAssetDbUrl = z.string()
    .min(1, 'URL cannot be empty')
    .describe('AssetDB URL. Equivalent asset-db paths are normalized to db:// URLs.')
    .transform((value, ctx) => {
        const parsed = SchemaUrl.safeParse(normalizeAssetDbUrlInput(value));

        if (!parsed.success) {
            parsed.error.errors.forEach((err) => {
                ctx.addIssue(err);
            });
            return z.NEVER;
        }

        return parsed.data;
    });

export const SchemaAssetDbUrlOrUUID = z.string()
    .min(1, 'Value cannot be empty')
    .describe('AssetDB URL or UUID. Equivalent asset-db paths are normalized to db:// URLs.')
    .transform((value, ctx) => {
        const cleaned = value.trim();
        const normalized = normalizeAssetDbUrlInput(cleaned);

        if (cleaned.startsWith('db://') || normalized.startsWith('db://')) {
            const parsed = SchemaAssetDbUrl.safeParse(cleaned);

            if (!parsed.success) {
                parsed.error.errors.forEach((err) => {
                    ctx.addIssue(err);
                });
                return z.NEVER;
            }

            return parsed.data;
        }

        const uuidResult = SchemaUUID.safeParse(cleaned);
        if (uuidResult.success) {
            return uuidResult.data;
        }

        const subAssetUUIDResult = SchemaSubAssetUUID.safeParse(cleaned);
        if (subAssetUUIDResult.success) {
            return subAssetUUIDResult.data;
        }

        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Invalid parameter. Use a db:// AssetDB URL, an equivalent asset-db path, or a UUID.',
        });
        return z.NEVER;
    });
