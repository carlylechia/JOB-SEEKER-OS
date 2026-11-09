import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'teChia Jobs',
    short_name: 'teChia Jobs',
    description: 'The AI-powered operating system for your job search.',
    start_url: '/',
    display: 'standalone',
    background_color: '#F7F8F3',
    theme_color: '#151715',
    icons: [
      { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  };
}
