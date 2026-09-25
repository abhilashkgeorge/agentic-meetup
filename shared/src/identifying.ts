/**
 * Does a sentence name where somebody works, studied or lives?
 *
 * THE GAP (HOW-IT-WORKS, section 11): contactDetail() stops phone numbers, handles,
 * links and street addresses, but "Not caught: a company or building named in words."
 * "I lead the payments team at Razorpay" is not a contact detail, and it is enough for a
 * stranger to find somebody on LinkedIn before a first message. The founder's item 14:
 * on "How you appear", flag sentences naming a company, a college or a building, and
 * ask "Hide this?".
 *
 * A SUGGESTION, NEVER A BLOCK. Nothing here stops a sentence; it only lets the screen
 * ask. So it leans towards asking -- a person reads one extra "Hide this?" and taps past
 * it -- but not so far that every sentence asks and the question means nothing: a
 * well-known company counts only where it reads as somewhere a person is ("at Infosys",
 * "joined Google", "the Amazon office"), not "I love Google Maps"; a building needs its
 * kind in its name ("Prestige Shantiniketan Apartments", "Manyata Tech Park"), so
 * "Cubbon Park" and "the mall" are left alone.
 *
 * Code, not a model: the same answer every time, and no sentence leaves the server.
 */
export type NamedPlace = 'company' | 'college' | 'building';

/** A capitalised name of up to four words, e.g. "St. Joseph's", "Christ", "RV". */
const NAME = String.raw`(?:[A-Z][\w.'&-]*)(?:\s+(?:of\s+)?[A-Z][\w.'&-]*){0,3}`;

const COLLEGE = [
  // The acronyms Indian graduates say instead of the name.
  /\b(?:IIT|IIM|NIT|IIIT|BITS|IISc|IISER|NLSIU|NLU|NID|NIFT|AIIMS|XLRI|ISB|SRCC|LSR)\b/,
  new RegExp(String.raw`\b${NAME}\s+(?:University|College|Institute|Academy|Polytechnic)\b`),
  /\b(?:University|College|Institute) of [A-Z]\w+/,
  new RegExp(String.raw`\b(?:studied|graduated|study|studying)\s+(?:at|from)\s+${NAME}`),
  new RegExp(String.raw`\b(?:alumn(?:us|a|i|ae)|batch)\s+of\s+${NAME}`),
];

const KNOWN_COMPANIES = [
  'Google', 'Microsoft', 'Amazon', 'Meta', 'Facebook', 'Apple', 'Netflix', 'Uber', 'Ola', 'Infosys', 'TCS',
  'Tata Consultancy', 'Wipro', 'HCL', 'Accenture', 'IBM', 'Deloitte', 'KPMG', 'PwC', 'EY', 'Flipkart', 'Swiggy',
  'Zomato', 'Paytm', 'PhonePe', 'Razorpay', 'CRED', 'Zepto', 'Myntra', 'Meesho', "BYJU'S", 'Byjus', 'Unacademy',
  'Goldman Sachs', 'JP Morgan', 'JPMorgan', 'Morgan Stanley', 'Intel', 'Qualcomm', 'Nvidia', 'Oracle', 'SAP',
  'Salesforce', 'Adobe', 'Cisco', 'Samsung', 'Walmart', 'Target', 'Dunzo', 'Freshworks', 'Zoho', 'Mindtree',
  'Cognizant', 'Capgemini', 'L&T', 'Reliance', 'Airtel', 'Jio', 'Mahindra', 'Tesla', 'Atlassian', 'Intuit',
  'McKinsey', 'BCG', 'Bain', 'Barclays', 'HSBC', 'Citi', 'Citibank', 'HDFC', 'ICICI', 'Axis Bank', 'Kotak',
];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const KNOWN = `(?:${KNOWN_COMPANIES.map(esc).join('|')})`;

const COMPANY = [
  // A known name where a person is: at, for, with, joined, from -- or its office. And
  // typed in lower case after a verb of working, the way people type in chat.
  new RegExp(String.raw`\b(?:at|for|with|joined|join|joining|from|in)\s+(?:the\s+)?${KNOWN}\b`),
  new RegExp(String.raw`\b(?:work|works|working|worked|intern|interning|job|employed)\s+(?:at|for|with|in)\s+${KNOWN}\b`, 'i'),
  new RegExp(String.raw`\b${KNOWN}(?:'s)?\s+(?:office|campus|team|HQ|headquarters)\b`, 'i'),
  // Any name with a company's ending.
  new RegExp(String.raw`\b${NAME}\s+(?:Pvt\.?\s*Ltd|Private Limited|Ltd|Limited|Inc|LLC|LLP|Technologies|Solutions|Labs|Corp|Corporation|Consulting|Software|Ventures|Capital)\b`),
  // "work at X", "intern at X", "job at X" -- with X a name, not "a startup".
  new RegExp(String.raw`\b(?:work|works|working|worked|intern|interning|job|employed)\s+(?:at|for|with)\s+${NAME}`),
];

const BUILDING = [
  new RegExp(String.raw`\b${NAME}\s+(?:Towers?|Apartments?|Residency|Residences|Enclave|Heights|Tech\s?Park|Techpark|IT\s+Park|Business\s+Park|SEZ|Tech\s+Village)\b`),
  // Bengaluru's big builders and campuses, named without the kind of building. Not
  // "Brigade": Brigade Road is a street everybody walks down.
  /\b(?:Manyata|Bagmane|RMZ|EcoSpace|Ecospace|EcoWorld|Ecoworld|ITPL|Salarpuria|Prestige|Sobha|Purva|Mantri|Embassy Golf Links)\b/,
];

/** What the sentence names, if anything: a college, a company, or a building. */
export function namesPlace(text: string): NamedPlace | null {
  if (COLLEGE.some((r) => r.test(text))) return 'college';
  if (COMPANY.some((r) => r.test(text))) return 'company';
  if (BUILDING.some((r) => r.test(text))) return 'building';
  return null;
}
