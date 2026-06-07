import type { deserialize } from 'cc';

// Mirrors Cocos 3.8.6 cocos/serialization/deserialize.ts.
// deserialize.Internal and deserialize._macros are type/test-editor only at runtime.

export type SharedString = deserialize.Internal.SharedString_;
export type Empty = deserialize.Internal.Empty_;
export type StringIndex = deserialize.Internal.StringIndex_;
export type InstanceIndex = deserialize.Internal.InstanceIndex_;
export type StringIndexBnotNumber = deserialize.Internal.StringIndexBnotNumber_;

export enum DataTypeID {
    SimpleType = 0,
    InstanceRef = 1,
    Array_InstanceRef = 2,
    Array_AssetRefByInnerObj = 3,
    Class = 4,
    ValueTypeCreated = 5,
    AssetRefByInnerObj = 6,
    TRS = 7,
    ValueType = 8,
    Array_Class = 9,
    CustomizedClass = 10,
    Dict = 11,
    Array = 12,
    ARRAY_LENGTH = 13,
}

export type DataTypes = deserialize.Internal.DataTypes_;
export type AnyData = deserialize.Internal.AnyData_;
export type OtherObjectData = deserialize.Internal.OtherObjectData_;
export type OtherObjectTypeID = deserialize.Internal.OtherObjectTypeID_;
export type AnyCCClass = deserialize.Internal.AnyCCClass_;

export type IClass = deserialize.Internal.IClass_;
export type IMask = deserialize.Internal.IMask_;
export type IClassObjectData = deserialize.Internal.IClassObjectData_;
export type ICustomObjectDataContent = deserialize.Internal.ICustomObjectDataContent_;
export type ICustomObjectData = deserialize.Internal.ICustomObjectData_;
export type ITRSData = deserialize.Internal.ITRSData_;
export type IDictData = deserialize.Internal.IDictData_;
export type IArrayData = deserialize.Internal.IArrayData_;

export const EMPTY_PLACEHOLDER = 0;
export const CLASS_TYPE = 0;
export const CLASS_KEYS = 1;
export const CLASS_PROP_TYPE_OFFSET = 2;
export const MASK_CLASS = 0;
export const OBJ_DATA_MASK = 0;
export const CUSTOM_OBJ_DATA_CLASS = 0;
export const CUSTOM_OBJ_DATA_CONTENT = 1;
export const DICT_JSON_LAYOUT = 0;
export const ARRAY_ITEM_VALUES = 0;

export enum Refs {
    EACH_RECORD_LENGTH = 3,
    OWNER_OFFSET = 0,
    KEY_OFFSET = 1,
    TARGET_OFFSET = 2,
}

export type IRefs = deserialize.Internal.IRefs_;

export enum File {
    Version = 0,
    Context = 0,
    SharedUuids = 1,
    SharedStrings = 2,
    SharedClasses = 3,
    SharedMasks = 4,
    Instances = 5,
    InstanceTypes = 6,
    Refs = 7,
    DependObjs = 8,
    DependKeys = 9,
    DependUuidIndices = 10,
    ARRAY_LENGTH = 11,
}

export const PACKED_SECTIONS = File.Instances;

export type IFileData = deserialize.Internal.IFileData_;
export type IPackedFileData = deserialize.Internal.IPackedFileData_;
