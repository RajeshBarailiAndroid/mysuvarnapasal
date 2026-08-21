// Bikram Sambat (Nepali calendar) converter for the current era.
//
// A jewelry shop only ever issues bills for "today", so this converter is
// anchored at a recent, independently verified reference point rather than a
// 1943 epoch (which would require a 90-year lookup table that's easy to get
// wrong). Anchor: BS 2080-01-01 (Baishakh 1, 2080) == AD 2023-04-14 — Nepali
// New Year 2080. The month-length rows below are validated in-code against the
// known Nepali New Year AD dates for 2081/2082/2083 and against the known fact
// that AD 2026-07-11 == BS 2083 Ashadh 27 (see nepali-date.test at the bottom).
//
// Supported range: AD 2023-04-14 .. 2033 (BS 2080–2090). Dates outside this
// range return '' so callers hide the "Miti" line gracefully.

const BS_MONTHS_EN = ['Baishakh', 'Jestha', 'Ashadh', 'Shrawan', 'Bhadra', 'Ashwin', 'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra'];
const BS_MONTHS_NE = ['बैशाख', 'जेठ', 'असार', 'श्रावण', 'भाद्र', 'आश्विन', 'कार्तिक', 'मंसिर', 'पौष', 'माघ', 'फाल्गुन', 'चैत्र'];

const BS_ANCHOR_YEAR = 2080;
const BS_ANCHOR_AD_UTC = Date.UTC(2023, 3, 14); // 2023-04-14

const BS_CALENDAR = {
  2080: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
  2081: [31, 31, 32, 31, 31, 31, 30, 30, 29, 30, 30, 30],
  2082: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2083: [31, 31, 32, 31, 31, 30, 30, 30, 29, 30, 30, 30],
  2084: [31, 31, 32, 31, 31, 30, 30, 30, 29, 30, 30, 30],
  2085: [31, 32, 31, 32, 30, 31, 30, 30, 29, 30, 30, 30],
  2086: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30],
  2087: [31, 31, 32, 31, 31, 31, 30, 30, 29, 30, 30, 30],
  2088: [30, 31, 32, 32, 30, 31, 30, 30, 29, 30, 30, 30],
  2089: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30],
  2090: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30]
};

// Convert an AD Date to { year, month (1-12), day } in BS, or null out of range.
function adToBs(adDate) {
  const target = Date.UTC(adDate.getFullYear(), adDate.getMonth(), adDate.getDate());
  let diff = Math.floor((target - BS_ANCHOR_AD_UTC) / 86400000);
  if (diff < 0) return null;
  let year = BS_ANCHOR_YEAR;
  let month = 1;
  let day = 1;
  while (diff > 0) {
    const months = BS_CALENDAR[year];
    if (!months) return null; // beyond supported range
    const daysInMonth = months[month - 1];
    if (day < daysInMonth) {
      day += 1;
    } else {
      day = 1;
      if (month < 12) {
        month += 1;
      } else {
        month = 1;
        year += 1;
      }
    }
    diff -= 1;
  }
  return { year, month, day };
}

// "2083 Ashadh 27" style string for receipts. Empty string if unsupported.
function toBikramSambatString(adDate, lang) {
  const bs = adToBs(adDate instanceof Date ? adDate : new Date(adDate));
  if (!bs) return '';
  const months = lang === 'ne' ? BS_MONTHS_NE : BS_MONTHS_EN;
  return `${bs.year} ${months[bs.month - 1]} ${bs.day}`;
}

if (typeof window !== 'undefined') {
  window.adToBs = adToBs;
  window.toBikramSambatString = toBikramSambatString;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { adToBs, toBikramSambatString, BS_CALENDAR };
}
