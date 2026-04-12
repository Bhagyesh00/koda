import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Koda — Your Private Coding Assistant',
  description: 'A private AI coding assistant that runs entirely on your machine.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="h-screen overflow-hidden bg-bg text-fg">{children}</body>
    </html>
  );
}
