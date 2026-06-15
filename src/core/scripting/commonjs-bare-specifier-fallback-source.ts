import { cjsMetaUrlExportName } from '@cocos/creator-programming-mod-lo/lib/cjs/share';

export function createCommonJSBareSpecifierFallbackSource(specifier: string): string {
    const escapedSpecifier = specifier.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return `
export const ${cjsMetaUrlExportName} = '${escapedSpecifier}';
`;
}
