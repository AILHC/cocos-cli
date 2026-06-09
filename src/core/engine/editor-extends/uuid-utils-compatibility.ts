type UuidUtilsCompatTarget = {
    compressUUID?: unknown;
    compressUuid?: unknown;
    decompressUUID?: unknown;
    decompressUuid?: unknown;
    isUUID?: unknown;
    isUuid?: unknown;
    generate?: unknown;
    uuid?: unknown;
};

export function installUuidUtilsCompatibility(uuidUtils: UuidUtilsCompatTarget | null | undefined) {
    if (!uuidUtils) {
        return;
    }

    uuidUtils.compressUuid = uuidUtils.compressUuid || uuidUtils.compressUUID;
    uuidUtils.decompressUuid = uuidUtils.decompressUuid || uuidUtils.decompressUUID;
    uuidUtils.isUuid = uuidUtils.isUuid || uuidUtils.isUUID;
    uuidUtils.uuid = uuidUtils.uuid || uuidUtils.generate;
}
