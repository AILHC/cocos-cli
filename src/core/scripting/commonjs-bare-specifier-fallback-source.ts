import { cjsMetaUrlExportName } from '@cocos/creator-programming-mod-lo/lib/cjs/share';
import { modLoBuiltinModCommonJsURL } from '@cocos/creator-programming-mod-lo/lib/utils/mod-lo-builtin-mods';

export function createCommonJSBareSpecifierFallbackSource(): string {
    return `
import loader from '${modLoBuiltinModCommonJsURL}';
loader.define(import.meta.url, function (_exports, _require, module) {
    module.exports = {};
});
export const ${cjsMetaUrlExportName} = import.meta.url;
`;
}
