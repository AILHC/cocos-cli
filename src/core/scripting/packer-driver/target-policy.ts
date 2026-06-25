export interface PackerTargetPolicyInput {
    isEditor?: boolean;
}

export function shouldUseTentativePrerequisiteImportsMod(
    _targetId: string,
    target: PackerTargetPolicyInput,
): boolean {
    return target.isEditor === true;
}
