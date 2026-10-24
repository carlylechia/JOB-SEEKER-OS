import { MATERIAL_TYPE_META, type MaterialType } from './materials';

export function buildApplicationMaterialTitle(params: {
  type: string;
  company: string | null;
  role: string | null;
  createdAt: Date;
}): string {
  const typeLabel = MATERIAL_TYPE_META[params.type as MaterialType]?.label ?? 'Application material';

  return [
    typeLabel,
    params.company?.trim() || 'General',
    params.role?.trim() || 'Unspecified role',
    params.createdAt.toISOString(),
  ].join(' — ');
}
