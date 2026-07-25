import {
    IUndoOperationOptions,
    IUndoRedoResult,
} from '../../common';
import { Rpc } from '../rpc';

export interface IUndoProxy {
    undo(options?: IUndoOperationOptions): Promise<IUndoRedoResult>;
    canUndo(options?: IUndoOperationOptions): Promise<boolean>;
    isDirty(): Promise<boolean>;
}

export interface IRedoProxy {
    redo(options?: IUndoOperationOptions): Promise<IUndoRedoResult>;
    canRedo(options?: IUndoOperationOptions): Promise<boolean>;
}

export const UndoProxy: IUndoProxy = {
    undo(options?: IUndoOperationOptions) {
        return Rpc.getInstance().request('Undo', 'undo', options === undefined ? [] : [options]);
    },
    canUndo(options?: IUndoOperationOptions) {
        return Rpc.getInstance().request('Undo', 'canUndo', options === undefined ? [] : [options]);
    },
    isDirty() {
        return Rpc.getInstance().request('Undo', 'isDirty');
    },
};

export const RedoProxy: IRedoProxy = {
    redo(options?: IUndoOperationOptions) {
        return Rpc.getInstance().request('Redo', 'redo', options === undefined ? [] : [options]);
    },
    canRedo(options?: IUndoOperationOptions) {
        return Rpc.getInstance().request('Redo', 'canRedo', options === undefined ? [] : [options]);
    },
};
