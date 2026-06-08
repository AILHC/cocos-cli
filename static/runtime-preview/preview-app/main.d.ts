import { Ui } from './ui.js';
import { bootstrap } from './index.js';
type RuntimePreviewReadyResource = {
    path: string;
    type: string;
    uuid?: string;
};
type RuntimePreviewReadyState = {
    scene: string;
    resources: RuntimePreviewReadyResource[];
    timestamp: number;
    limitation?: string;
};
declare global {
    interface Window {
        __RUNTIME_PREVIEW_READY?: RuntimePreviewReadyState;
    }
}
export declare function main(ui: Ui, options: bootstrap.Options): Promise<void>;
export {};
