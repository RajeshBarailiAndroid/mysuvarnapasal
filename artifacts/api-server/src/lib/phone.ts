const PHONE_REGIONS = ['NP', 'US', 'CA'];

function phoneDigits(phone: string): string {
  return String(phone || '').replace(/\D/g, '');
}

function isNepaliPhone(digits: string): boolean {
  const national = String(digits).replace(/^977/, '');
  return /^(97|98)\d{8}$/.test(national);
}

function isNanpPhone(digits: string): boolean {
  const d = String(digits).replace(/^1/, '');
  return d.length === 10 && /^[2-9]\d{2}[2-9]\d{6}$/.test(d);
}

function isUsPhone(digits: string): boolean {
  return isNanpPhone(digits);
}

function isCanadianPhone(digits: string): boolean {
  return isNanpPhone(digits);
}

export function normalizePhoneRegion(region: string): string {
  const code = String(region || 'NP').toUpperCase();
  return PHONE_REGIONS.includes(code) ? code : 'NP';
}

export function isValidPhoneForRegion(phone: string, region: string): boolean {
  const digits = phoneDigits(phone);
  if (!digits) return false;
  const r = normalizePhoneRegion(region);
  if (r === 'NP') return isNepaliPhone(digits);
  if (r === 'US') return isUsPhone(digits);
  if (r === 'CA') return isCanadianPhone(digits);
  return false;
}

export function isValidPhone(phone: string, region?: string): boolean {
  if (region) return isValidPhoneForRegion(phone, region);
  const digits = phoneDigits(phone);
  if (!digits) return false;
  return isNepaliPhone(digits) || isNanpPhone(digits);
}

export function phoneErrorMessage(region: string): string {
  const r = normalizePhoneRegion(region);
  if (r === 'NP') return 'Enter a valid Nepal mobile number (97/98XXXXXXXX or +977…).';
  if (r === 'US') return 'Enter a valid US phone number (10 digits).';
  if (r === 'CA') return 'Enter a valid Canadian phone number (10 digits).';
  return 'Enter a valid phone number.';
}
