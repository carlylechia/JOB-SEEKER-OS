import { DemoSlideshow } from '@/components/marketing/demo-slideshow';

export const metadata = {
  title: 'Demo — Job Seeker OS',
  description:
    'A sleek, full-screen walkthrough of Job Seeker OS: fit scoring, daily queue, pipeline, contacts, and what’s coming next.',
};

export default function DemoPage() {
  return <DemoSlideshow />;
}

