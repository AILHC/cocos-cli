type BuildConfigData = Record<string, any>;

interface NormalizeBuildConfigContext {
    platform?: string;
    taskId?: string;
}

function isRecord(value: unknown): value is BuildConfigData {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cloneRecord<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
}

function selectTaskOptions(taskOptionsMap: BuildConfigData, taskId?: string) {
    if (taskId) {
        if (!isRecord(taskOptionsMap[taskId])) {
            throw new Error(`Can not find build task options for taskId: ${taskId}`);
        }
        return taskOptionsMap[taskId];
    }

    const taskIds = Object.keys(taskOptionsMap);
    if (!taskIds.length) {
        return undefined;
    }
    if (taskIds.length > 1) {
        throw new Error('Multiple build task options found in Creator profile, please specify taskId.');
    }
    return taskOptionsMap[taskIds[0]];
}

export function normalizeBuildConfigData(data: BuildConfigData, context: NormalizeBuildConfigContext = {}): BuildConfigData {
    if (!isRecord(data.builder) || !isRecord(data.builder.common)) {
        return data;
    }

    const common = cloneRecord(data.builder.common);
    const platform = context.platform || common.platform || data.platform;
    const normalized: BuildConfigData = {
        ...common,
    };

    if (platform) {
        normalized.platform = platform;
    }

    if (isRecord(data.builder.taskOptionsMap)) {
        const taskOptions = selectTaskOptions(data.builder.taskOptionsMap, context.taskId || common.taskId || data.taskId);
        if (isRecord(taskOptions)) {
            const normalizedTaskOptions = cloneRecord(taskOptions);
            delete normalizedTaskOptions.__version__;

            const packages = isRecord(normalized.packages) ? normalized.packages : {};
            if (platform) {
                packages[platform] = {
                    ...(isRecord(packages[platform]) ? packages[platform] : {}),
                    ...normalizedTaskOptions,
                };
            }
            normalized.packages = packages;
        }
    }

    return normalized;
}

export function mergeBuildConfigData(data: BuildConfigData, commandOptions: BuildConfigData): BuildConfigData {
    const normalized = normalizeBuildConfigData(data, {
        platform: commandOptions.platform,
        taskId: commandOptions.taskId,
    });
    return Object.assign(normalized, commandOptions);
}
