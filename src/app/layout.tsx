@tailwind base;
@tailwind components;
@tailwind utilities;

export const metadata = {
  title: "BINF EVENTOS — Descubra eventos e viva experiências",
  description:
    "Encontre concertos, conferências, festivais e experiências únicas. Bilhetes digitais com compra segura.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt">
      <body>{children}</body>
    </html>
  );
}
