// Very mild blue gradient for the Ask Friday panel: near-white blue at the top
// deepening slightly toward the bottom, with two faint glows and three soft waves. Purely decorative,
// sits behind the chat content.
export default function FridayAmbientBg() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{
        background:
          "radial-gradient(90% 40% at 100% 0%, rgba(191,219,254,0.45) 0%, rgba(191,219,254,0) 70%)," +
          "radial-gradient(100% 45% at 100% 100%, rgba(165,205,253,0.45) 0%, rgba(165,205,253,0) 70%)," +
          "linear-gradient(180deg, #F2F7FF 0%, #E8F1FF 55%, #DDEAFE 100%)",
      }}
    >
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 400 800"
        preserveAspectRatio="none"
        fill="none"
      >
        <path d="M420 60C330 80 270 150 278 260C285 350 365 395 420 412V60Z" fill="#BFDBFE" fillOpacity="0.28" />
        <path d="M0 800C120 790 230 735 280 650C330 565 372 535 420 505V800H0Z" fill="#BFDBFE" fillOpacity="0.30" />
        <path d="M130 800C205 782 272 718 322 632C358 572 392 548 420 538V800H130Z" fill="#93C5FD" fillOpacity="0.20" />
      </svg>
    </div>
  );
}
