import { useState } from 'react';
import { getLogoUrl } from '../helpers';

interface AppLogoProps {
  appId: string;
  logoLetter: string;
  colorHex: string;
  logoUrl?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const SIZE_CLASSES = {
  sm:  { outer: 'w-8 h-8 rounded-xl',  font: '0.75rem' },
  md:  { outer: 'w-10 h-10 rounded-xl', font: '0.875rem' },
  lg:  { outer: 'w-12 h-12 rounded-2xl',font: '1rem' },
  xl:  { outer: 'w-14 h-14 rounded-2xl',font: '1.125rem' },
};

export function AppLogo({ appId, logoLetter, colorHex, logoUrl, size = 'md' }: AppLogoProps) {
  const [failed, setFailed] = useState(false);
  const url = logoUrl || getLogoUrl(appId);
  const { outer, font } = SIZE_CLASSES[size];

  if (url && !failed) {
    return (
      <div
        className={`${outer} flex items-center justify-center shrink-0 overflow-hidden`}
        style={{ backgroundColor: colorHex }}
      >
        <img
          src={url}
          alt=""
          className="w-3/4 h-3/4 object-contain drop-shadow-sm"
          onError={() => setFailed(true)}
        />
      </div>
    );
  }

  return (
    <div
      className={`${outer} flex items-center justify-center shrink-0 font-bold text-white`}
      style={{ backgroundColor: colorHex, fontSize: font }}
    >
      {logoLetter}
    </div>
  );
}
