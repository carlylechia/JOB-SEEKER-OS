export function JobSeekerHeroVideo() {
  return (
    <div className="absolute inset-0">
      <svg
        viewBox="0 0 1600 900"
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full"
        role="img"
        aria-label="Animated illustration of a job seeker reviewing applications at a desk"
      >
        <defs>
          <linearGradient id="hero-bg" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#120f1d" />
            <stop offset="52%" stopColor="#151a2a" />
            <stop offset="100%" stopColor="#08111f" />
          </linearGradient>
          <radialGradient id="hero-glow-a" cx="24%" cy="22%" r="42%">
            <stop offset="0%" stopColor="rgba(251,191,36,0.82)" />
            <stop offset="100%" stopColor="rgba(251,191,36,0)" />
          </radialGradient>
          <radialGradient id="hero-glow-b" cx="72%" cy="28%" r="36%">
            <stop offset="0%" stopColor="rgba(249,115,22,0.44)" />
            <stop offset="100%" stopColor="rgba(249,115,22,0)" />
          </radialGradient>
          <radialGradient id="lamp-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(255,228,163,0.8)" />
            <stop offset="100%" stopColor="rgba(255,228,163,0)" />
          </radialGradient>
          <linearGradient id="screen-glow" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#9ee8ff" />
            <stop offset="100%" stopColor="#2dd4bf" />
          </linearGradient>
          <filter id="soft-blur">
            <feGaussianBlur stdDeviation="24" />
          </filter>
        </defs>

        <rect width="1600" height="900" fill="url(#hero-bg)" />
        <circle cx="340" cy="170" r="260" fill="url(#hero-glow-a)" opacity="0.42">
          <animate attributeName="cy" values="170;184;170" dur="28s" repeatCount="indefinite" />
        </circle>
        <circle cx="1140" cy="220" r="240" fill="url(#hero-glow-b)" opacity="0.4">
          <animate attributeName="cx" values="1140;1114;1140" dur="24s" repeatCount="indefinite" />
        </circle>
        <circle cx="1180" cy="108" r="186" fill="url(#lamp-glow)" opacity="0.28">
          <animate attributeName="opacity" values="0.24;0.34;0.24" dur="18s" repeatCount="indefinite" />
        </circle>

        <g opacity="0.12">
          {Array.from({ length: 14 }).map((_, index) => (
            <line
              key={index}
              x1={120 + index * 100}
              y1="0"
              x2={120 + index * 100}
              y2="900"
              stroke="#99dfff"
              strokeWidth="1"
            />
          ))}
          {Array.from({ length: 8 }).map((_, index) => (
            <line
              key={`row-${index}`}
              x1="0"
              y1={120 + index * 90}
              x2="1600"
              y2={120 + index * 90}
              stroke="#99dfff"
              strokeWidth="1"
            />
          ))}
        </g>

        <g>
          <animateTransform attributeName="transform" type="translate" values="0 0; -10 8; 0 0" dur="34s" repeatCount="indefinite" />
          <animateTransform attributeName="transform" additive="sum" type="scale" values="1;1.018;1" dur="34s" repeatCount="indefinite" />

        <g transform="translate(980 126)" opacity="0.94">
          <animateTransform attributeName="transform" type="translate" values="980 126; 980 118; 980 126" dur="20s" repeatCount="indefinite" />
          <rect width="360" height="210" rx="26" fill="rgba(6,14,28,0.68)" stroke="rgba(255,255,255,0.16)" />
          <text x="28" y="42" fill="#dff7ff" fontSize="18" fontWeight="700">Application Tracker</text>
          <text x="28" y="68" fill="#8aa4c2" fontSize="14">Target companies for this week</text>
          <rect x="28" y="96" width="304" height="44" rx="16" fill="rgba(255,255,255,0.06)" />
          <text x="48" y="123" fill="#ffffff" fontSize="15" fontWeight="600">Senior Product Designer</text>
          <text x="48" y="143" fill="#90a7c6" fontSize="13">Canva · Resume tailored</text>
          <rect x="246" y="108" width="66" height="18" rx="9" fill="#34d399" opacity="0.22" />
          <text x="260" y="121" fill="#a7f3d0" fontSize="11" fontWeight="700">92 MATCH</text>
          <rect x="28" y="154" width="214" height="10" rx="5" fill="rgba(255,255,255,0.08)" />
          <rect x="28" y="154" width="168" height="10" rx="5" fill="url(#screen-glow)">
            <animate attributeName="width" values="150;176;168;150" dur="9s" repeatCount="indefinite" />
          </rect>
        </g>

        <g transform="translate(132 196)" opacity="0.92">
          <animateTransform attributeName="transform" type="translate" values="132 196; 132 206; 132 196" dur="22s" repeatCount="indefinite" />
          <rect width="300" height="170" rx="24" fill="rgba(6,14,28,0.62)" stroke="rgba(255,255,255,0.14)" />
          <text x="24" y="38" fill="#dff7ff" fontSize="16" fontWeight="700">Today&apos;s outreach</text>
          <rect x="24" y="58" width="252" height="30" rx="15" fill="rgba(255,255,255,0.05)" />
          <circle cx="43" cy="73" r="7" fill="#22d3ee" />
          <text x="60" y="78" fill="#dbeafe" fontSize="13">Message recruiter at Figma</text>
          <rect x="24" y="98" width="228" height="30" rx="15" fill="rgba(255,255,255,0.05)" />
          <circle cx="43" cy="113" r="7" fill="#34d399" />
          <text x="60" y="118" fill="#dbeafe" fontSize="13">Follow up with Stripe hiring team</text>
          <rect x="24" y="138" width="186" height="10" rx="5" fill="rgba(255,255,255,0.08)" />
          <rect x="24" y="138" width="124" height="10" rx="5" fill="#60a5fa" opacity="0.8" />
        </g>

        <g transform="translate(300 430)">
          <rect x="0" y="210" width="1000" height="22" rx="11" fill="rgba(2,6,23,0.74)" />
          <rect x="120" y="52" width="760" height="182" rx="26" fill="rgba(9,17,31,0.9)" stroke="rgba(255,255,255,0.08)" />
          <rect x="290" y="0" width="420" height="74" rx="24" fill="rgba(15,23,42,0.95)" />
          <rect x="314" y="16" width="372" height="42" rx="18" fill="#0b1324" stroke="rgba(255,255,255,0.08)" />
          <rect x="326" y="22" width="220" height="30" rx="14" fill="url(#screen-glow)" opacity="0.18" />
          <rect x="582" y="26" width="86" height="22" rx="11" fill="rgba(34,211,238,0.18)" />

          <g transform="translate(430 112)">
            <rect x="0" y="0" width="178" height="110" rx="16" fill="url(#screen-glow)" opacity="0.14" />
            <rect x="12" y="12" width="154" height="86" rx="12" fill="#0f1b33" stroke="rgba(255,255,255,0.08)" />
            <rect x="24" y="24" width="66" height="8" rx="4" fill="#8ee8ff" opacity="0.7" />
            <rect x="24" y="42" width="112" height="8" rx="4" fill="rgba(255,255,255,0.16)" />
            <rect x="24" y="58" width="98" height="8" rx="4" fill="rgba(255,255,255,0.12)" />
            <rect x="24" y="74" width="84" height="8" rx="4" fill="rgba(255,255,255,0.12)" />
          </g>

          <g transform="translate(186 36)">
            <ellipse cx="110" cy="102" rx="76" ry="90" fill="#0f172a" />
            <ellipse cx="110" cy="82" rx="70" ry="86" fill="#14223c" />
            <circle cx="120" cy="32" r="30" fill="#f0b394" />
            <path d="M92 28c4-28 58-38 74 4 4 12 1 28-4 34-8-16-30-18-41-18-12 0-26 3-37 13-4-7-2-22 8-33Z" fill="#111827" />
            <rect x="94" y="58" width="54" height="18" rx="9" fill="#efc0a5" />
            <path d="M56 112c18-30 108-36 136 0v92H56Z" fill="#7c3aed" opacity="0.95" />
            <path d="M160 130c18 8 40 22 58 30" stroke="#efc0a5" strokeWidth="16" strokeLinecap="round">
              <animate attributeName="d" values="M160 130c18 8 40 22 58 30;M160 130c22 10 44 14 60 18;M160 130c18 8 40 22 58 30" dur="6.5s" repeatCount="indefinite" />
            </path>
            <path d="M74 134c-20 18-32 42-38 60" stroke="#efc0a5" strokeWidth="16" strokeLinecap="round" />
            <rect x="212" y="146" width="22" height="16" rx="4" fill="#9ee8ff">
              <animate attributeName="x" values="212;216;212" dur="6.5s" repeatCount="indefinite" />
            </rect>
          </g>

          <g transform="translate(96 130)">
            <rect x="0" y="0" width="92" height="102" rx="18" fill="#111827" />
            <rect x="18" y="94" width="16" height="96" rx="8" fill="#111827" />
            <rect x="58" y="94" width="16" height="96" rx="8" fill="#111827" />
          </g>

          <g transform="translate(628 138)">
            <rect x="0" y="0" width="142" height="88" rx="12" fill="#0b1324" stroke="rgba(255,255,255,0.12)" />
            <rect x="10" y="10" width="122" height="62" rx="10" fill="#0f1d34" />
            <circle cx="70" cy="78" r="5" fill="#101826" />
            <rect x="40" y="88" width="62" height="8" rx="4" fill="#1f2937" />
          </g>

          <g opacity="0.72">
            <ellipse cx="500" cy="248" rx="260" ry="30" fill="rgba(255,196,107,0.18)" filter="url(#soft-blur)" />
          </g>
        </g>

        <g transform="translate(1080 530)" opacity="0.9">
          <animateTransform attributeName="transform" type="translate" values="1080 530; 1080 520; 1080 530" dur="18s" repeatCount="indefinite" />
          <rect width="260" height="126" rx="24" fill="rgba(6,14,28,0.64)" stroke="rgba(255,255,255,0.14)" />
          <text x="22" y="34" fill="#dff7ff" fontSize="16" fontWeight="700">Interview prep</text>
          <text x="22" y="58" fill="#8aa4c2" fontSize="13">2:00 PM · Product walkthrough</text>
          <rect x="22" y="78" width="216" height="10" rx="5" fill="rgba(255,255,255,0.08)" />
          <rect x="22" y="78" width="132" height="10" rx="5" fill="#34d399" opacity="0.9" />
          <rect x="22" y="98" width="88" height="8" rx="4" fill="rgba(255,255,255,0.14)" />
          <rect x="118" y="98" width="58" height="8" rx="4" fill="rgba(255,255,255,0.1)" />
        </g>
        </g>
      </svg>
    </div>
  );
}