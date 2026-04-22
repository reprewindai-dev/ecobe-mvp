import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'CO2 Router | Decision Infrastructure Interface',
  description:
    'CO2 Router is the public control plane for governed execution, audit, billing, and replay. The private engine stays behind the broker boundary.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
