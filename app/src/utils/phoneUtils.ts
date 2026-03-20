import { NativeModules } from 'react-native';

// ISO country code → phone calling code mapping
const COUNTRY_CALLING_CODES: Record<string, string> = {
  AE: '971', SA: '966', KW: '965', QA: '974', BH: '973', OM: '968',
  EG: '20', JO: '962', LB: '961', IQ: '964', SY: '963', YE: '967',
  PS: '970', LY: '218', SD: '249', TN: '216', DZ: '213', MA: '212',
  US: '1', CA: '1', GB: '44', IE: '353',
  IN: '91', PK: '92', BD: '880', LK: '94',
  FR: '33', DE: '49', IT: '39', ES: '34', NL: '31', BE: '32',
  TR: '90', RU: '7', CN: '86', JP: '81', KR: '82',
  AU: '61', NZ: '64', SG: '65', MY: '60', PH: '63', ID: '62', TH: '66',
  BR: '55', MX: '52', AR: '54', CO: '57', ZA: '27', NG: '234', KE: '254',
};

let cachedCallingCode: string | null = null;

async function getSimCallingCode(): Promise<string> {
  if (cachedCallingCode !== null) return cachedCallingCode;
  try {
    const iso: string = await NativeModules.CallLogModule.getSimCountryIso();
    cachedCallingCode = (iso && COUNTRY_CALLING_CODES[iso]) || '';
  } catch {
    cachedCallingCode = '';
  }
  return cachedCallingCode;
}

export async function normalizePhoneForWhatsApp(rawNumber: string): Promise<string> {
  let phone = rawNumber.replace(/[\s\-()]/g, '');

  // Already has + prefix → strip + and return digits
  if (phone.startsWith('+')) {
    return phone.substring(1).replace(/[^0-9]/g, '');
  }

  // International prefix 00 → strip it, rest is country code + number
  if (phone.startsWith('00')) {
    return phone.substring(2).replace(/[^0-9]/g, '');
  }

  const digits = phone.replace(/[^0-9]/g, '');
  const callingCode = await getSimCallingCode();

  if (!callingCode) {
    // No SIM info available, return digits as-is
    return digits;
  }

  // Local number starting with 0 → strip leading 0, prepend country code
  if (digits.startsWith('0')) {
    return callingCode + digits.substring(1);
  }

  // Short number without prefix → prepend country code
  return callingCode + digits;
}
