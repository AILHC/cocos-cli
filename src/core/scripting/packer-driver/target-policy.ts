export interface PackerTargetPolicyInput {
    isEditor?: boolean;
}

export function shouldUseTentativePrerequisiteImportsMod(
    targetId: string,
    target: PackerTargetPolicyInput,
): boolean {
    return target.isEditor === true || targetId === 'preview';
}
