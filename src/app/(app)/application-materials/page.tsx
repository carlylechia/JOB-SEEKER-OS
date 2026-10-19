/**
 * Application materials workspace page.
 *
 * Server shell that renders the client workspace. The workspace fetches the
 * caller's own materials from `/api/application-materials`, scoped by session
 * userId.
 */

import ApplicationMaterialsWorkspace from '@/components/application-materials/materials-workspace';

export default function ApplicationMaterialsPage() {
  return <ApplicationMaterialsWorkspace />;
}
