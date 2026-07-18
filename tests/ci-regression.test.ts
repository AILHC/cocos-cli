import * as fs from 'fs';
import * as path from 'path';

const rootDir = path.resolve(__dirname, '..');

function readJson(relativePath: string) {
    return JSON.parse(fs.readFileSync(path.join(rootDir, relativePath), 'utf8'));
}

function readText(relativePath: string) {
    return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

describe('CI regression guards', () => {
    it('keeps the vendored @cocos/asset-db workspace link consistent in package.json and package-lock.json', () => {
        const packageJson = readJson('package.json');
        const packageLock = readJson('package-lock.json');
        const expectedDependency = packageJson.dependencies['@cocos/asset-db'];
        const assetDbLink = packageLock.packages['node_modules/@cocos/asset-db'];

        expect(expectedDependency).toBe('file:./packages/asset-db');
        expect(packageLock.packages[''].dependencies['@cocos/asset-db']).toBe(expectedDependency);
        expect(assetDbLink).toEqual({
            resolved: 'packages/asset-db',
            link: true,
        });
        expect(packageLock.packages['packages/asset-db'].name).toBe('@cocos/asset-db');
    });

    it('does not allow Jest to resolve .d.ts files as runtime modules', () => {
        const jestConfig = readText('jest.config.ts');

        expect(jestConfig).not.toContain("'d.ts'");
    });

    it('uses npm ci in setup-env so CI installs the lockfile exactly', () => {
        const setupEnvAction = readText('.github/actions/setup-env/action.yml');

        expect(setupEnvAction).toMatch(/^\s*run:\s*npm ci\s*$/m);
        expect(setupEnvAction).not.toMatch(/^\s*run:\s*npm i\s*$/m);
    });
});
