/**
 * Countries and their dial codes.
 *
 * ThinkTac production reads this from a Firestore config document, `CountryCodes`,
 * shaped `{ countryCodes: { India: { phone: '+91' }, … } }`. That document lives in
 * a project this app cannot read, so the list is static here instead. It belongs
 * with the other controlled vocabularies in institution-options.ts: it changes with
 * a code release, not with user data, and reading it from Firestore would cost
 * another collection, another rule block, and a round trip before the form renders.
 *
 * ONE list feeds two controls. The Country select and the representative's dial-code
 * select are both derived from this array, so they can never disagree about which
 * countries exist.
 *
 * Flags are DERIVED from the ISO code rather than stored. A flag emoji is just its
 * two letters as regional indicator symbols, so deriving it removes 200 opportunities
 * to paste the wrong one.
 */

export interface Country {
  /** ISO 3166-1 alpha-2. The key, and what the flag is derived from. */
  readonly iso2: string;
  /** Display name, and what gets STORED in institutionAddress.country. */
  readonly name: string;
  /** E.164 dial code, stored in representativeCountryCode. */
  readonly dial: string;
}

/**
 * The country whose name should represent a dial code shared by several.
 *
 * +44 belongs to the UK, Guernsey, the Isle of Man and Jersey; without this the
 * dial list would label it "Guernsey" purely because G sorts before U.
 */
const DIAL_PRIMARY = new Set(['US', 'GB', 'RU', 'FI']);

/** Alphabetical by name, which is the order both selects render in. */
export const COUNTRIES: readonly Country[] = [
  { iso2: 'AF', name: 'Afghanistan', dial: '+93' },
  { iso2: 'AX', name: 'Åland Islands', dial: '+358' },
  { iso2: 'AL', name: 'Albania', dial: '+355' },
  { iso2: 'DZ', name: 'Algeria', dial: '+213' },
  { iso2: 'AS', name: 'American Samoa', dial: '+1684' },
  { iso2: 'AD', name: 'Andorra', dial: '+376' },
  { iso2: 'AO', name: 'Angola', dial: '+244' },
  { iso2: 'AI', name: 'Anguilla', dial: '+1264' },
  { iso2: 'AG', name: 'Antigua and Barbuda', dial: '+1268' },
  { iso2: 'AR', name: 'Argentina', dial: '+54' },
  { iso2: 'AM', name: 'Armenia', dial: '+374' },
  { iso2: 'AW', name: 'Aruba', dial: '+297' },
  { iso2: 'AU', name: 'Australia', dial: '+61' },
  { iso2: 'AT', name: 'Austria', dial: '+43' },
  { iso2: 'AZ', name: 'Azerbaijan', dial: '+994' },
  { iso2: 'BS', name: 'Bahamas', dial: '+1242' },
  { iso2: 'BH', name: 'Bahrain', dial: '+973' },
  { iso2: 'BD', name: 'Bangladesh', dial: '+880' },
  { iso2: 'BB', name: 'Barbados', dial: '+1246' },
  { iso2: 'BY', name: 'Belarus', dial: '+375' },
  { iso2: 'BE', name: 'Belgium', dial: '+32' },
  { iso2: 'BZ', name: 'Belize', dial: '+501' },
  { iso2: 'BJ', name: 'Benin', dial: '+229' },
  { iso2: 'BM', name: 'Bermuda', dial: '+1441' },
  { iso2: 'BT', name: 'Bhutan', dial: '+975' },
  { iso2: 'BO', name: 'Bolivia', dial: '+591' },
  { iso2: 'BA', name: 'Bosnia and Herzegovina', dial: '+387' },
  { iso2: 'BW', name: 'Botswana', dial: '+267' },
  { iso2: 'BR', name: 'Brazil', dial: '+55' },
  { iso2: 'BN', name: 'Brunei', dial: '+673' },
  { iso2: 'BG', name: 'Bulgaria', dial: '+359' },
  { iso2: 'BF', name: 'Burkina Faso', dial: '+226' },
  { iso2: 'BI', name: 'Burundi', dial: '+257' },
  { iso2: 'KH', name: 'Cambodia', dial: '+855' },
  { iso2: 'CM', name: 'Cameroon', dial: '+237' },
  { iso2: 'CA', name: 'Canada', dial: '+1' },
  { iso2: 'CV', name: 'Cape Verde', dial: '+238' },
  { iso2: 'KY', name: 'Cayman Islands', dial: '+1345' },
  { iso2: 'CF', name: 'Central African Republic', dial: '+236' },
  { iso2: 'TD', name: 'Chad', dial: '+235' },
  { iso2: 'CL', name: 'Chile', dial: '+56' },
  { iso2: 'CN', name: 'China', dial: '+86' },
  { iso2: 'CO', name: 'Colombia', dial: '+57' },
  { iso2: 'KM', name: 'Comoros', dial: '+269' },
  { iso2: 'CG', name: 'Congo', dial: '+242' },
  { iso2: 'CD', name: 'Congo (DRC)', dial: '+243' },
  { iso2: 'CK', name: 'Cook Islands', dial: '+682' },
  { iso2: 'CR', name: 'Costa Rica', dial: '+506' },
  { iso2: 'CI', name: "Côte d'Ivoire", dial: '+225' },
  { iso2: 'HR', name: 'Croatia', dial: '+385' },
  { iso2: 'CU', name: 'Cuba', dial: '+53' },
  { iso2: 'CW', name: 'Curaçao', dial: '+599' },
  { iso2: 'CY', name: 'Cyprus', dial: '+357' },
  { iso2: 'CZ', name: 'Czechia', dial: '+420' },
  { iso2: 'DK', name: 'Denmark', dial: '+45' },
  { iso2: 'DJ', name: 'Djibouti', dial: '+253' },
  { iso2: 'DM', name: 'Dominica', dial: '+1767' },
  { iso2: 'DO', name: 'Dominican Republic', dial: '+1809' },
  { iso2: 'EC', name: 'Ecuador', dial: '+593' },
  { iso2: 'EG', name: 'Egypt', dial: '+20' },
  { iso2: 'SV', name: 'El Salvador', dial: '+503' },
  { iso2: 'GQ', name: 'Equatorial Guinea', dial: '+240' },
  { iso2: 'ER', name: 'Eritrea', dial: '+291' },
  { iso2: 'EE', name: 'Estonia', dial: '+372' },
  { iso2: 'SZ', name: 'Eswatini', dial: '+268' },
  { iso2: 'ET', name: 'Ethiopia', dial: '+251' },
  { iso2: 'FJ', name: 'Fiji', dial: '+679' },
  { iso2: 'FI', name: 'Finland', dial: '+358' },
  { iso2: 'FR', name: 'France', dial: '+33' },
  { iso2: 'PF', name: 'French Polynesia', dial: '+689' },
  { iso2: 'GA', name: 'Gabon', dial: '+241' },
  { iso2: 'GM', name: 'Gambia', dial: '+220' },
  { iso2: 'GE', name: 'Georgia', dial: '+995' },
  { iso2: 'DE', name: 'Germany', dial: '+49' },
  { iso2: 'GH', name: 'Ghana', dial: '+233' },
  { iso2: 'GI', name: 'Gibraltar', dial: '+350' },
  { iso2: 'GR', name: 'Greece', dial: '+30' },
  { iso2: 'GL', name: 'Greenland', dial: '+299' },
  { iso2: 'GD', name: 'Grenada', dial: '+1473' },
  { iso2: 'GU', name: 'Guam', dial: '+1671' },
  { iso2: 'GT', name: 'Guatemala', dial: '+502' },
  { iso2: 'GG', name: 'Guernsey', dial: '+44' },
  { iso2: 'GN', name: 'Guinea', dial: '+224' },
  { iso2: 'GW', name: 'Guinea-Bissau', dial: '+245' },
  { iso2: 'GY', name: 'Guyana', dial: '+592' },
  { iso2: 'HT', name: 'Haiti', dial: '+509' },
  { iso2: 'HN', name: 'Honduras', dial: '+504' },
  { iso2: 'HK', name: 'Hong Kong', dial: '+852' },
  { iso2: 'HU', name: 'Hungary', dial: '+36' },
  { iso2: 'IS', name: 'Iceland', dial: '+354' },
  { iso2: 'IN', name: 'India', dial: '+91' },
  { iso2: 'ID', name: 'Indonesia', dial: '+62' },
  { iso2: 'IR', name: 'Iran', dial: '+98' },
  { iso2: 'IQ', name: 'Iraq', dial: '+964' },
  { iso2: 'IE', name: 'Ireland', dial: '+353' },
  { iso2: 'IM', name: 'Isle of Man', dial: '+44' },
  { iso2: 'IL', name: 'Israel', dial: '+972' },
  { iso2: 'IT', name: 'Italy', dial: '+39' },
  { iso2: 'JM', name: 'Jamaica', dial: '+1876' },
  { iso2: 'JP', name: 'Japan', dial: '+81' },
  { iso2: 'JE', name: 'Jersey', dial: '+44' },
  { iso2: 'JO', name: 'Jordan', dial: '+962' },
  { iso2: 'KZ', name: 'Kazakhstan', dial: '+7' },
  { iso2: 'KE', name: 'Kenya', dial: '+254' },
  { iso2: 'KI', name: 'Kiribati', dial: '+686' },
  { iso2: 'KW', name: 'Kuwait', dial: '+965' },
  { iso2: 'KG', name: 'Kyrgyzstan', dial: '+996' },
  { iso2: 'LA', name: 'Laos', dial: '+856' },
  { iso2: 'LV', name: 'Latvia', dial: '+371' },
  { iso2: 'LB', name: 'Lebanon', dial: '+961' },
  { iso2: 'LS', name: 'Lesotho', dial: '+266' },
  { iso2: 'LR', name: 'Liberia', dial: '+231' },
  { iso2: 'LY', name: 'Libya', dial: '+218' },
  { iso2: 'LI', name: 'Liechtenstein', dial: '+423' },
  { iso2: 'LT', name: 'Lithuania', dial: '+370' },
  { iso2: 'LU', name: 'Luxembourg', dial: '+352' },
  { iso2: 'MO', name: 'Macao', dial: '+853' },
  { iso2: 'MG', name: 'Madagascar', dial: '+261' },
  { iso2: 'MW', name: 'Malawi', dial: '+265' },
  { iso2: 'MY', name: 'Malaysia', dial: '+60' },
  { iso2: 'MV', name: 'Maldives', dial: '+960' },
  { iso2: 'ML', name: 'Mali', dial: '+223' },
  { iso2: 'MT', name: 'Malta', dial: '+356' },
  { iso2: 'MH', name: 'Marshall Islands', dial: '+692' },
  { iso2: 'MR', name: 'Mauritania', dial: '+222' },
  { iso2: 'MU', name: 'Mauritius', dial: '+230' },
  { iso2: 'MX', name: 'Mexico', dial: '+52' },
  { iso2: 'FM', name: 'Micronesia', dial: '+691' },
  { iso2: 'MD', name: 'Moldova', dial: '+373' },
  { iso2: 'MC', name: 'Monaco', dial: '+377' },
  { iso2: 'MN', name: 'Mongolia', dial: '+976' },
  { iso2: 'ME', name: 'Montenegro', dial: '+382' },
  { iso2: 'MS', name: 'Montserrat', dial: '+1664' },
  { iso2: 'MA', name: 'Morocco', dial: '+212' },
  { iso2: 'MZ', name: 'Mozambique', dial: '+258' },
  { iso2: 'MM', name: 'Myanmar', dial: '+95' },
  { iso2: 'NA', name: 'Namibia', dial: '+264' },
  { iso2: 'NR', name: 'Nauru', dial: '+674' },
  { iso2: 'NP', name: 'Nepal', dial: '+977' },
  { iso2: 'NL', name: 'Netherlands', dial: '+31' },
  { iso2: 'NC', name: 'New Caledonia', dial: '+687' },
  { iso2: 'NZ', name: 'New Zealand', dial: '+64' },
  { iso2: 'NI', name: 'Nicaragua', dial: '+505' },
  { iso2: 'NE', name: 'Niger', dial: '+227' },
  { iso2: 'NG', name: 'Nigeria', dial: '+234' },
  { iso2: 'NU', name: 'Niue', dial: '+683' },
  { iso2: 'KP', name: 'North Korea', dial: '+850' },
  { iso2: 'MK', name: 'North Macedonia', dial: '+389' },
  { iso2: 'NO', name: 'Norway', dial: '+47' },
  { iso2: 'OM', name: 'Oman', dial: '+968' },
  { iso2: 'PK', name: 'Pakistan', dial: '+92' },
  { iso2: 'PW', name: 'Palau', dial: '+680' },
  { iso2: 'PS', name: 'Palestine', dial: '+970' },
  { iso2: 'PA', name: 'Panama', dial: '+507' },
  { iso2: 'PG', name: 'Papua New Guinea', dial: '+675' },
  { iso2: 'PY', name: 'Paraguay', dial: '+595' },
  { iso2: 'PE', name: 'Peru', dial: '+51' },
  { iso2: 'PH', name: 'Philippines', dial: '+63' },
  { iso2: 'PL', name: 'Poland', dial: '+48' },
  { iso2: 'PT', name: 'Portugal', dial: '+351' },
  { iso2: 'PR', name: 'Puerto Rico', dial: '+1787' },
  { iso2: 'QA', name: 'Qatar', dial: '+974' },
  { iso2: 'RO', name: 'Romania', dial: '+40' },
  { iso2: 'RU', name: 'Russia', dial: '+7' },
  { iso2: 'RW', name: 'Rwanda', dial: '+250' },
  { iso2: 'KN', name: 'Saint Kitts and Nevis', dial: '+1869' },
  { iso2: 'LC', name: 'Saint Lucia', dial: '+1758' },
  { iso2: 'VC', name: 'Saint Vincent and the Grenadines', dial: '+1784' },
  { iso2: 'WS', name: 'Samoa', dial: '+685' },
  { iso2: 'SM', name: 'San Marino', dial: '+378' },
  { iso2: 'ST', name: 'Sao Tome and Principe', dial: '+239' },
  { iso2: 'SA', name: 'Saudi Arabia', dial: '+966' },
  { iso2: 'SN', name: 'Senegal', dial: '+221' },
  { iso2: 'RS', name: 'Serbia', dial: '+381' },
  { iso2: 'SC', name: 'Seychelles', dial: '+248' },
  { iso2: 'SL', name: 'Sierra Leone', dial: '+232' },
  { iso2: 'SG', name: 'Singapore', dial: '+65' },
  { iso2: 'SK', name: 'Slovakia', dial: '+421' },
  { iso2: 'SI', name: 'Slovenia', dial: '+386' },
  { iso2: 'SB', name: 'Solomon Islands', dial: '+677' },
  { iso2: 'SO', name: 'Somalia', dial: '+252' },
  { iso2: 'ZA', name: 'South Africa', dial: '+27' },
  { iso2: 'KR', name: 'South Korea', dial: '+82' },
  { iso2: 'SS', name: 'South Sudan', dial: '+211' },
  { iso2: 'ES', name: 'Spain', dial: '+34' },
  { iso2: 'LK', name: 'Sri Lanka', dial: '+94' },
  { iso2: 'SD', name: 'Sudan', dial: '+249' },
  { iso2: 'SR', name: 'Suriname', dial: '+597' },
  { iso2: 'SE', name: 'Sweden', dial: '+46' },
  { iso2: 'CH', name: 'Switzerland', dial: '+41' },
  { iso2: 'SY', name: 'Syria', dial: '+963' },
  { iso2: 'TW', name: 'Taiwan', dial: '+886' },
  { iso2: 'TJ', name: 'Tajikistan', dial: '+992' },
  { iso2: 'TZ', name: 'Tanzania', dial: '+255' },
  { iso2: 'TH', name: 'Thailand', dial: '+66' },
  { iso2: 'TL', name: 'Timor-Leste', dial: '+670' },
  { iso2: 'TG', name: 'Togo', dial: '+228' },
  { iso2: 'TO', name: 'Tonga', dial: '+676' },
  { iso2: 'TT', name: 'Trinidad and Tobago', dial: '+1868' },
  { iso2: 'TN', name: 'Tunisia', dial: '+216' },
  { iso2: 'TR', name: 'Türkiye', dial: '+90' },
  { iso2: 'TM', name: 'Turkmenistan', dial: '+993' },
  { iso2: 'TC', name: 'Turks and Caicos Islands', dial: '+1649' },
  { iso2: 'TV', name: 'Tuvalu', dial: '+688' },
  { iso2: 'UG', name: 'Uganda', dial: '+256' },
  { iso2: 'UA', name: 'Ukraine', dial: '+380' },
  { iso2: 'AE', name: 'United Arab Emirates', dial: '+971' },
  { iso2: 'GB', name: 'United Kingdom', dial: '+44' },
  { iso2: 'US', name: 'United States', dial: '+1' },
  { iso2: 'UY', name: 'Uruguay', dial: '+598' },
  { iso2: 'UZ', name: 'Uzbekistan', dial: '+998' },
  { iso2: 'VU', name: 'Vanuatu', dial: '+678' },
  { iso2: 'VA', name: 'Vatican City', dial: '+379' },
  { iso2: 'VE', name: 'Venezuela', dial: '+58' },
  { iso2: 'VN', name: 'Vietnam', dial: '+84' },
  { iso2: 'YE', name: 'Yemen', dial: '+967' },
  { iso2: 'ZM', name: 'Zambia', dial: '+260' },
  { iso2: 'ZW', name: 'Zimbabwe', dial: '+263' }
];

/** The default, matching production, whose Country select opens on India. */
export const DEFAULT_COUNTRY = 'India';

/** The dial code that pairs with DEFAULT_COUNTRY. */
export const DEFAULT_DIAL = dialFor(DEFAULT_COUNTRY);

/**
 * The flag emoji for an ISO code.
 *
 * A regional indicator symbol sits 0x1F1E6 above 'A', so two letters map straight
 * onto the flag. Nothing to keep in sync and nothing to mistype.
 */
export function flagOf(iso2: string): string {
  return iso2
    .toUpperCase()
    .replace(/[A-Z]/g, letter =>
      String.fromCodePoint(0x1f1e6 + letter.charCodeAt(0) - 65)
    );
}

/** Country names, for the Country select. */
export const COUNTRY_NAMES: readonly string[] = COUNTRIES.map(country => country.name);

/** The dial code for a country name, falling back to India's. */
export function dialFor(name: string): string {
  return COUNTRIES.find(country => country.name === name)?.dial ?? '+91';
}

/**
 * Dial codes for the phone control, one entry per DISTINCT code.
 *
 * Deduplicated because four identical "+44" rows help nobody. DIAL_PRIMARY decides
 * which country names the shared code; every other collision keeps whichever came
 * first alphabetically, which is correct when the countries are peers.
 */
export const DIAL_CODES: readonly { code: string; label: string; flag: string }[] =
  (() => {
    const byDial = new Map<string, Country>();

    for (const country of COUNTRIES) {
      const held = byDial.get(country.dial);

      if (!held || DIAL_PRIMARY.has(country.iso2)) {
        byDial.set(country.dial, country);
      }
    }

    return [...byDial.values()]
      .map(country => ({
        code: country.dial,
        label: country.name,
        flag: flagOf(country.iso2)
      }))
      .sort((left, right) => left.label.localeCompare(right.label));
  })();
