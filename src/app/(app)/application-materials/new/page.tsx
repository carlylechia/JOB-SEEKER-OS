'use client';

/**
 * Create a new application material.
 *
 * Renders the material editor in create mode. A `?job=` query parameter pre
 * selects a target job from an entry point such as the job detail page.
 */

import MaterialEditor from '@/components/application-materials/material-editor';

export default function NewMaterialPage() {
  return <MaterialEditor />;
}
