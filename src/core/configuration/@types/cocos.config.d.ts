import { ImportConfiguration } from '../../assets/@types/config-export';

// 用于 schema 校验规则导出
export interface COCOS_CONFIG {
    $schema?: string;
    version: string;
    import?: Pick<ImportConfiguration, 'restoreAssetDBFromCache' | 'globList' | 'createTemplateRoot'>;
}
