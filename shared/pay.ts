/**
 * Salary bands, cadres and cost to company on top of a grade structure
 * (Grading & Rewards Framework workbook).
 *
 * Job grades come from job evaluation points; consecutive job grades are grouped
 * into salary bands that carry pay. Each band belongs to a cadre, which sets its
 * entitlements. All money is per month in the structure's currency.
 */
import type { GradeBand } from './engine';

export type RetirementScheme = 'Provident Fund' | 'Gratuity' | 'Both' | 'None';
export const RETIREMENT_SCHEMES: RetirementScheme[] = ['Provident Fund', 'Gratuity', 'Both', 'None'];
export type Conveyance = 'Car' | 'Motorcycle';

/** A salary band: a run of consecutive job grades sharing one pay range. */
export interface PayBandInput {
  code: string;
  cadre: string;
  gradeFrom: number;
  gradeTo: number;
  /** Name of a tier in PayModel.tiers; sets the range spread. */
  tier: string;
  /** Overlap with the band below; null = the standard overlap. Ignored for the lowest band (the anchor). */
  overlapOverride: number | null;
  /** Salaries in the band are rounded to this multiple. */
  rounding: number;
}

/** Entitlements shared by every band in a cadre. */
export interface CadreInput {
  name: string;
  designations: string;
  promotion: string;
  qualification: string;
  experience: string;
  /** Benefit vehicle class (a PayModel.vehicles class); '' = no vehicle. */
  vehicleClass: string;
  toolsVehicle: string;
  simRetail: string;
  simAll: string;
  floatingCash: string;
  conveyance: Conveyance;
  /** Hotel cap per night, incl. taxes. */
  hotelCap: number;
  /** Share of the hotel cap paid when no hotel is used (0.2–0.25). */
  hotelNonUtilisation: number;
  /** One meal. */
  mealRate: number;
  transport: string;
  /** In-patient cover per family per year; null = covered by social security instead. */
  ipdCover: number | null;
  room: string;
  /** Out-patient limit in months of basic per year (0 = social security). */
  opdMonths: number;
  /** Group life cover as a multiple of gross monthly salary. */
  lifeMultiple: number;
  /** Covered by provincial social security (PESSI / SESSI). */
  socialSecurity: boolean;
}

export interface PayModel {
  currency: string;
  minimumWages: { region: string; amount: number; note: string }[];
  /** Region whose minimum wage applies. */
  region: string;
  /** Minimum of the lowest band; every other band is chained from it. */
  anchor: number;
  /** Raise the anchor to the applicable minimum wage when it is lower. */
  liftToMinimumWage: boolean;
  /** Standard overlap: band minimum = maximum of the band below × (1 − overlap). */
  overlap: number;
  /** Range spread per tier: maximum = minimum × (1 + spread). */
  tiers: { name: string; spread: number }[];
  /** Salary split: gross = basic × (1 + house rent + utilities). */
  houseRent: number;
  utilities: number;
  retirement: RetirementScheme;
  /** Employer provident fund contribution, share of basic. */
  pfRate: number;
  /** Gratuity, months of basic per year of service. */
  gratuityMonths: number;
  /** Old-age benefit (EOBI): employer / employee share of the wage base. */
  eobiEmployer: number;
  eobiEmployee: number;
  /** EOBI wage base; null = the applicable minimum wage. */
  eobiBase: number | null;
  /** Social security (PESSI / SESSI) employer share of covered wages. */
  socialSecurityRate: number;
  /** Covered wage cap; null = the applicable minimum wage. */
  socialSecurityCap: number | null;
  /** Bonus provision, months of basic per year. */
  bonusMonths: number;
  /** Car allowance per month as a share of the vehicle value. */
  carAllowanceRate: number;
  carAllowanceRounding: number;
  vehicles: { vehicleClass: string; model: string; price: number }[];
  fuelPrice: number;
  carKmPerLitre: number;
  bikeKmPerLitre: number;
  hotelRounding: number;
  mealsOutstation: number;
  mealsLocal: number;
  /** Rounding of grade zones inside a band. */
  zoneRounding: number;
  bands: PayBandInput[];
  cadres: CadreInput[];
}

// ------------------------------------------------------------------ helpers

/** Excel MROUND: nearest multiple, halves away from zero. */
export function mround(n: number, multiple: number): number {
  if (!multiple) return n;
  return Math.sign(n) * Math.round(Math.abs(n) / multiple + 1e-9) * multiple;
}
/** Excel CEILING for positive values. */
export function ceiling(n: number, multiple: number): number {
  return multiple ? Math.ceil(n / multiple - 1e-9) * multiple : n;
}

export function minimumWage(m: PayModel): number {
  return m.minimumWages.find((w) => w.region === m.region)?.amount ?? 0;
}

// -------------------------------------------------------------- calculation

export interface CadreResult extends CadreInput {
  vehicleModel: string | null;
  vehicleValue: number | null;
  /** null = no vehicle entitlement. */
  carAllowance: number | null;
  fuelNorm: string;
  fuelRatePerKm: number;
  hotelNonUtilisationPerDay: number;
  foodOutstationPerDay: number;
  foodLocalPerDay: number;
}

export interface BandResult extends PayBandInput {
  min: number;
  mid: number;
  max: number;
  spread: number;
  /** Actual spread after rounding. */
  spreadActual: number;
  overlapApplied: number | null;
  overlapActual: number | null;
  midpointProgression: number | null;
  belowMinimumWage: boolean;
  pointsFrom: number | null;
  pointsTo: number | null;
  basic: number;
  houseRent: number;
  utilities: number;
  cadreResult: CadreResult | null;
  /** OPD limit per year; null = social security. */
  opdLimit: number | null;
  groupLife: number;
  employer: { pf: number; gratuity: number; eobi: number; socialSecurity: number; bonus: number };
  ctcMonthly: number;
  ctcAnnual: number;
}

export interface GradeZone {
  grade: number;
  band: string;
  cadre: string;
  gradesInBand: number;
  positionInBand: number;
  bandMin: number;
  bandMid: number;
  bandMax: number;
  zoneMin: number;
  zoneRef: number;
  zoneMax: number;
}

export interface PayTable {
  currency: string;
  minimumWage: number;
  bands: BandResult[];
  zones: GradeZone[];
  /** Coverage and input problems; bands still compute where possible. */
  problems: string[];
}

export function salarySplit(gross: number, m: PayModel) {
  const basic = Math.round(gross / (1 + m.houseRent + m.utilities));
  const houseRent = Math.round(basic * m.houseRent);
  return { basic, houseRent, utilities: gross - basic - houseRent };
}

export function employerCosts(gross: number, basic: number, m: PayModel, cadre: Pick<CadreInput, 'socialSecurity'> | null, opts: { pfMember?: boolean } = {}) {
  const wage = minimumWage(m);
  const pfScheme = m.retirement === 'Provident Fund' || m.retirement === 'Both';
  return {
    pf: pfScheme && opts.pfMember !== false ? Math.round(basic * m.pfRate) : 0,
    gratuity: m.retirement === 'Gratuity' || m.retirement === 'Both' ? Math.round((basic * m.gratuityMonths) / 12) : 0,
    eobi: Math.round((m.eobiBase ?? wage) * m.eobiEmployer),
    socialSecurity: cadre?.socialSecurity ? Math.round(Math.min(gross, m.socialSecurityCap ?? wage) * m.socialSecurityRate) : 0,
    bonus: Math.round((basic * m.bonusMonths) / 12),
  };
}

export function cadreResult(c: CadreInput, m: PayModel): CadreResult {
  const vehicle = c.vehicleClass ? m.vehicles.find((v) => v.vehicleClass === c.vehicleClass) ?? null : null;
  const km = c.conveyance === 'Car' ? m.carKmPerLitre : m.bikeKmPerLitre;
  return {
    ...c,
    vehicleModel: vehicle?.model ?? null,
    vehicleValue: vehicle?.price ?? null,
    carAllowance: vehicle ? mround(vehicle.price * m.carAllowanceRate, m.carAllowanceRounding) : null,
    fuelNorm: `1 litre per ${km} km (${c.conveyance})`,
    fuelRatePerKm: km ? Math.round((m.fuelPrice / km) * 100) / 100 : 0,
    hotelNonUtilisationPerDay: mround(c.hotelCap * c.hotelNonUtilisation, m.hotelRounding),
    foodOutstationPerDay: c.mealRate * m.mealsOutstation,
    foodLocalPerDay: c.mealRate * m.mealsLocal,
  };
}

/** Checks that the bands cover every job grade once, lowest to highest, with no gaps. */
export function coverageProblems(m: PayModel, grades: GradeBand[]): string[] {
  const out: string[] = [];
  const nums = grades.map((g) => g.grade).sort((a, b) => a - b);
  if (!m.bands.length) return ['Add at least one salary band'];
  const bands = [...m.bands].sort((a, b) => a.gradeFrom - b.gradeFrom);
  if (bands[0].gradeFrom !== nums[0]) out.push(`${bands[0].code} must start at grade ${nums[0]}`);
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i];
    if (b.gradeTo < b.gradeFrom) out.push(`${b.code}: "to" grade is below the "from" grade`);
    if (i > 0 && b.gradeFrom !== bands[i - 1].gradeTo + 1) out.push(`${b.code} must start at grade ${bands[i - 1].gradeTo + 1} (gap or overlap with ${bands[i - 1].code})`);
    if (!m.tiers.some((t) => t.name === b.tier)) out.push(`${b.code}: unknown tier "${b.tier}"`);
    if (!m.cadres.some((c) => c.name === b.cadre)) out.push(`${b.code}: unknown cadre "${b.cadre}"`);
  }
  const top = nums[nums.length - 1];
  if (bands[bands.length - 1].gradeTo !== top) out.push(`${bands[bands.length - 1].code} must end at the top grade (${top})`);
  const codes = m.bands.map((b) => b.code);
  if (new Set(codes).size !== codes.length) out.push('Band codes must be unique');
  return out;
}

export function computePay(m: PayModel, grades: GradeBand[]): PayTable {
  const wage = minimumWage(m);
  const sortedGrades = [...grades].sort((a, b) => a.grade - b.grade);
  const pointsOf = (g: number) => sortedGrades.find((x) => x.grade === g)?.minPoints ?? null;
  const bands = [...m.bands].sort((a, b) => a.gradeFrom - b.gradeFrom);
  const cadres = new Map(m.cadres.map((c) => [c.name, cadreResult(c, m)]));
  const out: BandResult[] = [];
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i];
    const below = out[i - 1];
    const spread = m.tiers.find((t) => t.name === b.tier)?.spread ?? 0;
    const overlapApplied = below ? b.overlapOverride ?? m.overlap : null;
    const min = below
      ? mround(below.max * (1 - overlapApplied!), b.rounding)
      : m.liftToMinimumWage ? Math.max(m.anchor, ceiling(wage, b.rounding)) : m.anchor;
    const max = mround(min * (1 + spread), b.rounding);
    const mid = mround((min + max) / 2, b.rounding);
    const split = salarySplit(mid, m);
    const cadre = cadres.get(b.cadre) ?? null;
    const employer = employerCosts(mid, split.basic, m, cadre);
    const nextPoints = pointsOf(b.gradeTo + 1);
    const ctcMonthly = mid + (cadre?.carAllowance ?? 0) + employer.pf + employer.gratuity + employer.eobi + employer.socialSecurity + employer.bonus;
    out.push({
      ...b,
      min,
      mid,
      max,
      spread,
      spreadActual: min ? max / min - 1 : 0,
      overlapApplied,
      overlapActual: below ? 1 - min / below.max : null,
      midpointProgression: below ? mid / below.mid - 1 : null,
      belowMinimumWage: min < wage,
      pointsFrom: pointsOf(b.gradeFrom),
      pointsTo: nextPoints === null ? null : nextPoints - 1,
      ...split,
      cadreResult: cadre,
      opdLimit: cadre && cadre.opdMonths > 0 ? mround(split.basic * cadre.opdMonths, 1000) : null,
      groupLife: mid * (cadre?.lifeMultiple ?? 0),
      employer,
      ctcMonthly,
      ctcAnnual: ctcMonthly * 12,
    });
  }

  const zones: GradeZone[] = [];
  for (const g of sortedGrades) {
    const b = out.find((x) => g.grade >= x.gradeFrom && g.grade <= x.gradeTo);
    if (!b) continue;
    const n = b.gradeTo - b.gradeFrom + 1;
    const pos = g.grade - b.gradeFrom + 1;
    const zoneMin = mround(b.min + ((pos - 1) / n) * (b.max - b.min), m.zoneRounding);
    const zoneMax = mround(b.min + (pos / n) * (b.max - b.min), m.zoneRounding);
    zones.push({
      grade: g.grade, band: b.code, cadre: b.cadre, gradesInBand: n, positionInBand: pos,
      bandMin: b.min, bandMid: b.mid, bandMax: b.max,
      zoneMin, zoneRef: mround((zoneMin + zoneMax) / 2, m.zoneRounding), zoneMax,
    });
  }
  return { currency: m.currency, minimumWage: wage, bands: out, zones, problems: coverageProblems(m, grades) };
}

/** Pay placement of a job grade (what a job on that grade shows). */
export function zoneFor(table: PayTable | null | undefined, grade: number | null | undefined): (GradeZone & { currency: string }) | null {
  if (!table || grade == null) return null;
  const z = table.zones.find((x) => x.grade === grade);
  return z ? { ...z, currency: table.currency } : null;
}

export type PlacementPosition = 'Below minimum wage' | 'Below band' | 'Above band' | 'In band, below zone' | 'In band, above zone' | 'In zone';

/** Places one salary against its grade's band and zone (Placement & CTC sheet). */
export function placeSalary(
  table: PayTable,
  m: PayModel,
  grade: number,
  salary: number,
  opts: { vehicle?: boolean; pfMember?: boolean } = {},
) {
  const z = table.zones.find((x) => x.grade === grade);
  if (!z) return null;
  const band = table.bands.find((b) => b.code === z.band)!;
  const position: PlacementPosition =
    salary < table.minimumWage ? 'Below minimum wage'
      : salary < z.bandMin ? 'Below band'
        : salary > z.bandMax ? 'Above band'
          : salary < z.zoneMin ? 'In band, below zone'
            : salary > z.zoneMax ? 'In band, above zone' : 'In zone';
  const split = salarySplit(salary, m);
  const employer = employerCosts(salary, split.basic, m, band.cadreResult, { pfMember: opts.pfMember });
  const carAllowance = opts.vehicle ? band.cadreResult?.carAllowance ?? 0 : 0;
  const ctcMonthly = salary + carAllowance + employer.pf + employer.gratuity + employer.eobi + employer.socialSecurity + employer.bonus;
  return {
    zone: z,
    compaRatio: salary / z.bandMid,
    rangePenetration: z.bandMax > z.bandMin ? (salary - z.bandMin) / (z.bandMax - z.bandMin) : 0,
    position,
    ...split,
    carAllowance,
    employer,
    ctcMonthly,
    ctcAnnual: ctcMonthly * 12,
  };
}

// ---------------------------------------------------------------- templates

const FRAMEWORK_VEHICLES: PayModel['vehicles'] = [
  { vehicleClass: '660 CC', model: 'Suzuki Alto VXL AGS', price: 3326446 },
  { vehicleClass: '1000 CC', model: 'Suzuki Cultus VXL AGS', price: 4591460 },
  { vehicleClass: '1300 CC', model: 'Toyota Yaris 1.3 GLi CVT', price: 4809000 },
  { vehicleClass: '1600 CC', model: 'Toyota Corolla 1.6 AT', price: 6699000 },
  { vehicleClass: '1800 CC', model: 'Toyota Corolla Altis Grande 1.8 CVT', price: 7669000 },
  { vehicleClass: 'SUV (Top Executive)', model: 'Toyota Fortuner (entry variant)', price: 12435000 },
];

export const PAKISTAN_MINIMUM_WAGES: PayModel['minimumWages'] = [
  { region: 'Punjab', amount: 40000, note: 'Carried forward from 1 Jul 2025; no 2026-27 rate notified as of 1 Oct 2026' },
  { region: 'Sindh', amount: 43000, note: '2026-27 rate as reported; verify against the Sindh gazette' },
  { region: 'Islamabad (ICT)', amount: 40700, note: 'Federal Budget 2026-27' },
  { region: 'Khyber Pakhtunkhwa', amount: 45000, note: 'KP Budget 2026-27' },
  { region: 'Balochistan', amount: 37000, note: 'Last known rate; 2026-27 not confirmed' },
];

/** Cadre entitlements of the workbook, lowest first. */
export const FRAMEWORK_CADRES: CadreInput[] = [
  {
    name: 'Staff',
    designations: 'Assistant Shop Manager, Salesman, Stockboy Driver, Guard, Office Boy, Cleaner',
    promotion: 'As Per Need',
    qualification: 'Matric/F.A/F.Sc.',
    experience: 'As Per Need',
    vehicleClass: '',
    toolsVehicle: 'N/A',
    simRetail: 'N/A',
    simAll: 'N/A',
    floatingCash: 'N/A',
    conveyance: 'Motorcycle',
    hotelCap: 3000,
    hotelNonUtilisation: 0.25,
    mealRate: 250,
    transport: 'Actual - AC bus or AC class rail',
    ipdCover: null,
    room: 'PESSI facility',
    opdMonths: 0,
    lifeMultiple: 24,
    socialSecurity: true
  },
  {
    name: 'Officer',
    designations: 'Warehouse Officer, Planning Officer, CSR, Graphics Designer, HR Officer, Accounts Officer, IT Officer, Shop Manager, Sr. Assistant Shop Manager',
    promotion: '1 Year',
    qualification: 'BS, B.A, B. Sc.',
    experience: '0-1 Years',
    vehicleClass: '',
    toolsVehicle: 'N/A',
    simRetail: 'N/A',
    simAll: 'N/A',
    floatingCash: 'N/A',
    conveyance: 'Motorcycle',
    hotelCap: 5000,
    hotelNonUtilisation: 0.25,
    mealRate: 500,
    transport: 'Actual - AC bus or AC class rail',
    ipdCover: 400000,
    room: 'Semi-private',
    opdMonths: 1,
    lifeMultiple: 24,
    socialSecurity: false
  },
  {
    name: 'Executive',
    designations: 'Business Strategy Executive, Warehouse Executive, Planning Executive, HR Executive, Accounts Executive, Graphics Designer, IT Executive, CSR, Ecom Executive, Sr. Shop Manager',
    promotion: '2 Years',
    qualification: 'BS, B.A, B. Sc.',
    experience: '1-3 Years',
    vehicleClass: '',
    toolsVehicle: 'N/A',
    simRetail: 'N/A',
    simAll: 'As Per Business Need',
    floatingCash: 'As Per Business Need',
    conveyance: 'Motorcycle',
    hotelCap: 5000,
    hotelNonUtilisation: 0.25,
    mealRate: 800,
    transport: 'Actual - AC bus or AC class rail',
    ipdCover: 400000,
    room: 'Semi-private',
    opdMonths: 1,
    lifeMultiple: 24,
    socialSecurity: false
  },
  {
    name: 'Sr. Executive',
    designations: 'Sr. Business Strategy Executive, Sr. Warehouse Executive, Sr. Planning Executive, Sr. HR Executive, Sr. Accounts Executive, Sr. Graphics Designer, Sr. IT Executive, Sr. CSR, Sr. Ecom Executive',
    promotion: '2 Years',
    qualification: 'BS, B.A, B. Sc.',
    experience: '1-3 Years',
    vehicleClass: '',
    toolsVehicle: 'N/A',
    simRetail: 'N/A',
    simAll: 'As Per Business Need',
    floatingCash: 'As Per Business Need',
    conveyance: 'Motorcycle',
    hotelCap: 5000,
    hotelNonUtilisation: 0.25,
    mealRate: 800,
    transport: 'Actual - AC bus or AC class rail',
    ipdCover: 600000,
    room: 'Semi-private',
    opdMonths: 1,
    lifeMultiple: 24,
    socialSecurity: false
  },
  {
    name: 'AM',
    designations: 'AM HR, AM IT, AM Accounts, AM Warehouse, AM Category, AM Planning, AM Creative Design, Area Sales Manager',
    promotion: '2 Years',
    qualification: 'BS, B.A, B. Sc.',
    experience: '3-5 Years',
    vehicleClass: '',
    toolsVehicle: 'As Per Business Need',
    simRetail: 'Pro 600 + 32 GB Internet',
    simAll: 'As Per Business Need',
    floatingCash: 'As Per Business Need',
    conveyance: 'Motorcycle',
    hotelCap: 10000,
    hotelNonUtilisation: 0.25,
    mealRate: 1000,
    transport: 'Actual - AC bus or AC class rail',
    ipdCover: 600000,
    room: 'Semi-private',
    opdMonths: 1,
    lifeMultiple: 24,
    socialSecurity: false
  },
  {
    name: 'Manager',
    designations: 'Manager Supply Chain, Manager HR & Admin, Manager Finance & Accounts, Manager Category, Manager Warehouse, Manager Operations, Manager HR, Manager Accounts, Manager IT, Manager Quality, Manager Ecom Operations, Manager Performance Marketing, Regional Sales Manager',
    promotion: '3 Years',
    qualification: 'MSc,MBA,CA,ACCA,M.Phil',
    experience: '7-10 Years',
    vehicleClass: '660 CC',
    toolsVehicle: 'As Per Business Need',
    simRetail: 'Pro 600 + 55 GB Internet',
    simAll: 'As Per Business Need',
    floatingCash: 'As Per Business Need',
    conveyance: 'Car',
    hotelCap: 15000,
    hotelNonUtilisation: 0.2,
    mealRate: 1500,
    transport: 'Actual - Economy class by air or premium class AC bus or first class rail AC parlor ( For air approval from director required)',
    ipdCover: 800000,
    room: 'Private',
    opdMonths: 1,
    lifeMultiple: 24,
    socialSecurity: false
  },
  {
    name: 'Senior Manager',
    designations: 'Sr. Manager Supply Chain, Sr. Manager Finance & Accounts, Sr. Manager HR & Admin, Sr. Manager Category, Sr. Manager Warehouse, Sr. Manager Operations, Sr. Manager HR, Sr. Manager Accounts, Sr. Manager IT, Sr. Manager Quality, Sr. Manager Ecom Operations, Sr. Manager Performance Marketing, National Sales Manager',
    promotion: '5 Years',
    qualification: 'MA,MSc,BSs,MBA,MS/MPhil,Phd',
    experience: '10-15 Years',
    vehicleClass: '1000 CC',
    toolsVehicle: 'As Per Business Need',
    simRetail: 'Pro 900 + 55 GB Internet',
    simAll: 'As Per Business Need',
    floatingCash: 'As Per Business Need',
    conveyance: 'Car',
    hotelCap: 15000,
    hotelNonUtilisation: 0.2,
    mealRate: 1500,
    transport: 'Actual - Economy class by air or premium class AC bus or first class rail AC parlor ( For air approval from director required)',
    ipdCover: 1000000,
    room: 'Private',
    opdMonths: 1,
    lifeMultiple: 24,
    socialSecurity: false
  },
  {
    name: 'DGM',
    designations: 'DGM Sales & Marketing, DGM HR & Admin, DGM Supply Chain, DGM Finance & Accounts',
    promotion: '5 Year',
    qualification: 'MA,MSc,BSs,MBA,MS/MPhil,Phd',
    experience: '15-20 Years',
    vehicleClass: '1300 CC',
    toolsVehicle: 'As Per Business Need',
    simRetail: 'Pro 1600 + 100 GB Internet',
    simAll: 'As Per Business Need',
    floatingCash: 'As Per Business Need',
    conveyance: 'Car',
    hotelCap: 20000,
    hotelNonUtilisation: 0.25,
    mealRate: 2000,
    transport: 'Actual - Economy class by air or premium class AC bus or first class rail AC parlor ( For air approval from director required)',
    ipdCover: 1500000,
    room: 'Private',
    opdMonths: 1,
    lifeMultiple: 24,
    socialSecurity: false
  },
  {
    name: 'GM',
    designations: 'GM Sales & Marketing, GM HR & Admin, GM Supply Chain, GM Finance & Accounts',
    promotion: '5 Year',
    qualification: 'MA,MSc,BSs,MBA,MS/MPhil,Phd',
    experience: '20-25 Years',
    vehicleClass: '1600 CC',
    toolsVehicle: 'As Per Business Need',
    simRetail: 'Pro 2200 + 100 GB Internet',
    simAll: 'As Per Business Need',
    floatingCash: 'As Per Business Need',
    conveyance: 'Car',
    hotelCap: 25000,
    hotelNonUtilisation: 0.2,
    mealRate: 2000,
    transport: 'Actual - Economy class by air or premium class AC bus or first class rail AC parlor ( For air approval from director required)',
    ipdCover: 2000000,
    room: 'Private',
    opdMonths: 1,
    lifeMultiple: 24,
    socialSecurity: false
  },
  {
    name: 'Chief',
    designations: 'Chief Commercial Officer, Chief People Officer, Chief Merchandising Officer, Chief Financial Officer',
    promotion: '—',
    qualification: 'MA,MSc,BSs,MBA,MS/MPhil,Phd',
    experience: '25-30 Years',
    vehicleClass: '1800 CC',
    toolsVehicle: 'As Per Business Need',
    simRetail: 'Pro Unlimited + 165 GB Internet',
    simAll: 'As Per Business Need',
    floatingCash: 'As Per Business Need',
    conveyance: 'Car',
    hotelCap: 30000,
    hotelNonUtilisation: 0.225,
    mealRate: 2000,
    transport: 'Actual - Economy class by air or premium class AC bus or first class rail AC parlor ( For air approval from director required)',
    ipdCover: 2500000,
    room: 'Private',
    opdMonths: 1,
    lifeMultiple: 24,
    socialSecurity: false
  },
  {
    name: 'Top Executive',
    designations: 'CEO / Managing Director, Group CEO',
    promotion: '—',
    qualification: 'MA,MSc,BSs,MBA,MS/MPhil,Phd',
    experience: '25+ Years',
    vehicleClass: 'SUV (Top Executive)',
    toolsVehicle: 'As Per Business Need',
    simRetail: 'Pro Unlimited + 165 GB Internet',
    simAll: 'As Per Business Need',
    floatingCash: 'As Per Business Need',
    conveyance: 'Car',
    hotelCap: 35000,
    hotelNonUtilisation: 0.2,
    mealRate: 2500,
    transport: 'Actual - Economy class by air or premium class AC bus or first class rail AC parlor',
    ipdCover: 3000000,
    room: 'Private',
    opdMonths: 1,
    lifeMultiple: 24,
    socialSecurity: false
  }
];

/** The workbook's 11 bands over the 23 standard job grades. */
const FRAMEWORK_BANDS: [string, string, number, number, string][] = [
  ['B-1', 'Staff', 1, 5, 'Junior'],
  ['B-2', 'Officer', 6, 7, 'Mid'],
  ['B-3', 'Executive', 8, 9, 'Mid'],
  ['B-4', 'Sr. Executive', 10, 10, 'Mid'],
  ['B-5', 'AM', 11, 11, 'Mid'],
  ['B-6', 'Manager', 12, 13, 'Mid'],
  ['B-7', 'Senior Manager', 14, 15, 'Senior'],
  ['B-8', 'DGM', 16, 16, 'Senior'],
  ['B-9', 'GM', 17, 18, 'Senior'],
  ['B-10', 'Chief', 19, 20, 'Senior'],
  ['B-11', 'Top Executive', 21, 23, 'Senior'],
];

/** Market and policy inputs of the workbook (Pakistan, Punjab, PKR per month). */
export function frameworkInputs(): Omit<PayModel, 'bands' | 'cadres'> {
  return {
    currency: 'PKR',
    minimumWages: PAKISTAN_MINIMUM_WAGES.map((w) => ({ ...w })),
    region: 'Punjab',
    anchor: 36000,
    liftToMinimumWage: true,
    overlap: 0.1,
    tiers: [
      { name: 'Junior', spread: 0.4 },
      { name: 'Mid', spread: 0.5 },
      { name: 'Senior', spread: 0.6 },
    ],
    houseRent: 0.45,
    utilities: 0.1,
    retirement: 'Provident Fund',
    pfRate: 0.0833,
    gratuityMonths: 1,
    eobiEmployer: 0.05,
    eobiEmployee: 0.01,
    eobiBase: null,
    socialSecurityRate: 0.06,
    socialSecurityCap: null,
    bonusMonths: 0,
    carAllowanceRate: 0.01,
    carAllowanceRounding: 1000,
    vehicles: FRAMEWORK_VEHICLES.map((v) => ({ ...v })),
    fuelPrice: 398.3,
    carKmPerLitre: 10,
    bikeKmPerLitre: 30,
    hotelRounding: 500,
    mealsOutstation: 2,
    mealsLocal: 1,
    zoneRounding: 1000,
  };
}

/** The full workbook model: 11 bands and 11 cadres over the 23 standard grades. */
export function frameworkPayModel(): PayModel {
  return {
    ...frameworkInputs(),
    bands: FRAMEWORK_BANDS.map(([code, cadre, gradeFrom, gradeTo, tier]) => ({ code, cadre, gradeFrom, gradeTo, tier, overlapOverride: null, rounding: 5000 })),
    cadres: FRAMEWORK_CADRES.map((c) => ({ ...c })),
  };
}

/**
 * Groups `grades` into `bandCount` salary bands of near-equal size (extra grades go to
 * the lower bands). The lowest band is Junior, the top 40% Senior, the rest Mid; cadres
 * are taken from the framework's ladder by relative position unless given.
 */
export function generatePayBands(
  grades: GradeBand[],
  bandCount: number,
  opts: { tiers?: string[]; cadreNames?: string[]; rounding?: number; prefix?: string } = {},
): PayBandInput[] {
  const nums = grades.map((g) => g.grade).sort((a, b) => a - b);
  const k = Math.max(1, Math.min(nums.length, Math.round(bandCount)));
  const base = Math.floor(nums.length / k);
  const extra = nums.length % k;
  const tiers = opts.tiers ?? ['Junior', 'Mid', 'Senior'];
  const ladder = opts.cadreNames ?? FRAMEWORK_CADRES.map((c) => c.name);
  const out: PayBandInput[] = [];
  let at = 0;
  for (let i = 0; i < k; i++) {
    const size = base + (i < extra ? 1 : 0);
    const frac = k === 1 ? 0 : i / (k - 1);
    const tier = i === 0 ? tiers[0] : frac >= 0.6 ? tiers[tiers.length - 1] : tiers[Math.min(1, tiers.length - 1)];
    const cadre = opts.cadreNames && opts.cadreNames.length === k ? opts.cadreNames[i] : ladder[Math.round(frac * (ladder.length - 1))];
    out.push({ code: `${opts.prefix ?? 'B-'}${i + 1}`, cadre, gradeFrom: nums[at], gradeTo: nums[at + size - 1], tier, overlapOverride: null, rounding: opts.rounding ?? 5000 });
    at += size;
  }
  return out;
}

/** Framework inputs with bands generated for any grade structure; uses the framework bands for the 23 standard grades. */
export function payModelFor(grades: GradeBand[], bandCount?: number): PayModel {
  const m = frameworkPayModel();
  if (grades.length === 23 && (bandCount === undefined || bandCount === 11)) return m;
  const bands = generatePayBands(grades, bandCount ?? Math.max(1, Math.round(grades.length / 2)));
  return { ...m, bands, cadres: m.cadres.filter((c) => bands.some((b) => b.cadre === c.name)) };
}

export const EMPTY_CADRE = (name: string): CadreInput => ({
  name, designations: '', promotion: '', qualification: '', experience: '', vehicleClass: '', toolsVehicle: 'N/A',
  simRetail: 'N/A', simAll: 'N/A', floatingCash: 'N/A', conveyance: 'Motorcycle', hotelCap: 0, hotelNonUtilisation: 0.25,
  mealRate: 0, transport: '', ipdCover: null, room: '', opdMonths: 0, lifeMultiple: 24, socialSecurity: false,
});
