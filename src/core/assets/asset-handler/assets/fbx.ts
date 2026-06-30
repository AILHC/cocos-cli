import { AssetHandlerBase } from '../../@types/protected';
import GltfHandler from './gltf';

export const FbxHandler: AssetHandlerBase = {
    ...GltfHandler,

    // Handler 的名字，用于指定 Handler as 等
    name: 'fbx',

    propertySchemaConfig: {
        ...(GltfHandler.propertySchemaConfig ?? {}),
        legacyFbxImporter: {
            label: 'i18n:ENGINE.assets.fbx.legacyFbxImporter.name',
            description: 'i18n:ENGINE.assets.fbx.legacyFbxImporter.title',
            default: false,
            render: { ui: 'ui-checkbox' },
        },
        fbx: {
            label: 'i18n:ENGINE.assets.fbx.fbx',
            type: 'object',
            default: {
                unitConversion: 'geometry-level',
                animationBakeRate: 24,
                preferLocalTimeSpan: true,
                smartMaterialEnabled: false,
                matchMeshNames: false,
            },
            itemConfigs: {
                unitConversion: {
                    label: 'i18n:importer.property_schema.fbx.unit_conversion',
                    default: 'geometry-level',
                    render: {
                        ui: 'ui-select',
                        items: [
                            { label: 'i18n:importer.property_schema.fbx.unit_conversion_geometry_level', value: 'geometry-level' },
                            { label: 'i18n:importer.property_schema.fbx.unit_conversion_hierarchy_level', value: 'hierarchy-level' },
                            { label: 'i18n:importer.property_schema.fbx.unit_conversion_disabled', value: 'disabled' },
                        ],
                    },
                },
                animationBakeRate: {
                    label: 'i18n:ENGINE.assets.fbx.animationBakeRate.name',
                    description: 'i18n:ENGINE.assets.fbx.animationBakeRate.title',
                    default: 24,
                    render: {
                        ui: 'ui-select',
                        items: [
                            { label: 'i18n:ENGINE.assets.fbx.animationBakeRate.auto', value: '0' },
                            { label: '24 FPS', value: '24' },
                            { label: '25 FPS', value: '25' },
                            { label: '30 FPS', value: '30' },
                            { label: '60 FPS', value: '60' },
                        ],
                    },
                },
                preferLocalTimeSpan: {
                    label: 'i18n:ENGINE.assets.fbx.preferLocalTimeSpan.name',
                    description: 'i18n:ENGINE.assets.fbx.preferLocalTimeSpan.title',
                    default: true,
                    render: { ui: 'ui-checkbox' },
                },
                smartMaterialEnabled: {
                    label: 'i18n:ENGINE.assets.fbx.smartMaterialEnabled.name',
                    description: 'i18n:ENGINE.assets.fbx.smartMaterialEnabled.title',
                    default: false,
                    render: { ui: 'ui-checkbox' },
                },
                matchMeshNames: {
                    label: 'i18n:importer.property_schema.fbx.match_mesh_names',
                    default: false,
                    render: { ui: 'ui-checkbox' },
                },
            },
        },
    },
};

export default FbxHandler;
