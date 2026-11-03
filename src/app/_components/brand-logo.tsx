import Image from "next/image";
import logo from "@/assets/imagens/FIM.png";

export default function BrandLogo() {
  return (
    <>
      <span className="brand-logo-frame">
        <Image
          className="brand-logo-image"
          src={logo}
          alt="BINF — Soluções que geram valor e confiança"
          priority
        />
      </span>
      <span className="brand-logo-word">EVENTOS</span>
    </>
  );
}
