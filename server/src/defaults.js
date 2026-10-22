// What a new firm starts with. Seeded once, per org, inside the sign-up
// transaction, and re-appliable afterwards because every insert here is
// ON CONFLICT DO NOTHING against a live-rows unique index.
//
// These are the firm's own numbers and names, lifted from the workbook, not
// defaults invented for them. They are seeds rather than constants: every one
// of them is editable once the register exists, which is the point of moving
// them out of a spreadsheet.

/**
 * The controlled type list. Twelve disciplines are claimed; the workbook had
 * five with content and four as empty sheets, and the rest have not been named
 * yet. A placeholder is fully usable - no pre-built tasks, freehand work,
 * everything downstream still works - so registering it now is honest, where
 * inventing its task list would not be.
 */
export const DEFAULT_PROJECT_TYPES = [
  { code: "STRATAREPORT", name: "Strata report" },
  { code: "CONSENT USE", name: "Consent use" },
  { code: "REZONING", name: "Rezoning" },
  { code: "REMOVAL OF RESTRICTIONS", name: "Removal of restrictions" },
  { code: "TOWNSHIP establishment", name: "Township establishment" },
  { code: "BOQ", name: "Bill of quantities", isPlaceholder: true },
  { code: "CONSTRUCTION COST JBCC", name: "Construction cost (JBCC)", isPlaceholder: true },
  { code: "CONSOLIDATION", name: "Consolidation", isPlaceholder: true },
  // The workbook's sheet is spelled SUBDVISION. The code keeps the misspelling
  // so an import matches, and the display name is the correct word.
  { code: "SUBDVISION", name: "Subdivision", isPlaceholder: true },
];

/** The four tariff bands the fee templates price against. */
export const DEFAULT_RATE_BANDS = [
  { code: "A1", label: "Principal", hourlyRate: 3600 },
  { code: "A2", label: "Professional staff", hourlyRate: 3100 },
  { code: "B", label: "Salaried technical", hourlyRate: 2300 },
  { code: "C", label: "Other staff", hourlyRate: 1900 },
];

/**
 * What a BOQ prices a drawing against, transcribed from
 * `web/samples/tsp-rates.json` - the mock catalogue the drawing app used to
 * fetch from disk, with the file's own note carried across. The name says what
 * it is on purpose: a firm that has not yet typed its own prices in must be
 * able to see that from the book picker, because a BOQ priced off a demo
 * catalogue looks exactly like a BOQ priced off a real one.
 *
 * A line with no `model` is its category's fallback, used when the SKU itself
 * has no price (web/v2/schedule.js's findRate()). `unit` is restricted to what
 * qtyForUnit() measures; anything else counts items.
 */
export const DEFAULT_RATE_BOOK = {
  name: "TSP demo rates",
  currency: "ZAR",
  symbol: "R",
  note: "Mock TSP catalog for demo. Replace with the live price book.",
  rates: [
    { model: "TSP_CON052", description: "Masonry 220mm foundation perimeter (plaster)", unit: "m3", rate: 3180 },
    { model: "TSP_EW132", description: "Masonry 220mm foundation (no plaster)", unit: "m3", rate: 2740 },
    { model: "TSP_MAS007", description: "Pool masonry 220mm (plaster)", unit: "m3", rate: 3920 },
    { model: "TSP_MAS008", description: "Masonry wall 110mm (plaster)", unit: "m3", rate: 3650 },
    { model: "TSP_MAS009", description: "Masonry wall 220mm (plaster)", unit: "m3", rate: 4250 },
    { model: "TSP_RB016", description: "Floor generic 85mm", unit: "m2", rate: 890 },
    { model: "TSP_RB017", description: "170mm slab \u2014 balcony", unit: "m2", rate: 1240 },
    { model: "TSP_RB018", description: "Floor generic 255mm", unit: "m2", rate: 1680 },
    { model: "TSP_RB020", description: "Pool concrete floor 170mm", unit: "m2", rate: 1420 },
    { model: "TSP_RB387", description: "170mm slab \u2014 roof", unit: "m2", rate: 1180 },
    { model: "TSP_RC003", description: "Basic roof 125mm", unit: "m2", rate: 960 },
    { model: "TSP_DR813", description: "Door 813 \u00d7 2032mm", unit: "ea", rate: 4200 },
    { model: "TSP_DR900", description: "Door 900 \u00d7 2100mm", unit: "ea", rate: 4800 },
    { model: "TSP_DR1020", description: "Door 1020 \u00d7 2100mm", unit: "ea", rate: 5400 },
    { model: "TSP_WN0606", description: "High window 600 \u00d7 600mm", unit: "ea", rate: 2800 },
    { model: "TSP_WN0912", description: "Window 900 \u00d7 1200mm", unit: "ea", rate: 4100 },
    { model: "TSP_WN1212", description: "Window 1200 \u00d7 1200mm", unit: "ea", rate: 4900 },
    { model: "TSP_WN1812", description: "Window 1800 \u00d7 1200mm", unit: "ea", rate: 6200 },
    { model: "TSP_WN2415", description: "Window 2400 \u00d7 1500mm", unit: "ea", rate: 8900 },
    { model: "TSP_BM220", description: "Timber beam 220mm", unit: "m", rate: 890 },
    { model: "TSP_WC001", description: "WC suite", unit: "ea", rate: 2100 },
    { model: "TSP_VAN06", description: "Vanity 600mm", unit: "ea", rate: 2800 },
    { model: "TSP_VAN01", description: "Vanity 900mm", unit: "ea", rate: 3400 },
    { model: "TSP_SKT01", description: "Socket outlet", unit: "ea", rate: 180 },
    { category: "Doors", description: "Doors (each)", unit: "ea", rate: 4800 },
    { category: "Windows", description: "Windows (each)", unit: "ea", rate: 6200 },
    { category: "Walls", description: "Walls fallback (volume)", unit: "m3", rate: 3800 },
    { category: "Floors", description: "Floors fallback (area)", unit: "m2", rate: 980 },
    { category: "Roofs", description: "Roofs fallback (area)", unit: "m2", rate: 920 },
  ],
};

/**
 * One canonical list. The workbook's timesheets carry two, differing by row
 * range, which is how the same afternoon gets filed under two names.
 */
export const ACTIVITY_TYPES = [
  "Phone call", "Report", "File work", "Meeting", "Site visit", "Admin",
  "Networking", "Town planning", "Architectural work", "Training", "Marketing",
  "Travel", "Print", "Daily huddle", "Friday club", "Excel work", "Finances", "Other",
];

/**
 * Time spent running the firm rather than doing a client's work. Drives the
 * billable share on the team report; a type not listed here counts as client
 * work, because guessing "internal" would flatter nobody and hide real hours.
 */
export const INTERNAL_ACTIVITY_TYPES = [
  "Admin", "Networking", "Training", "Marketing", "Daily huddle",
  "Friday club", "Excel work", "Finances", "Other",
];

/**
 * Why value was given up. `legacy_unspecified` is not offered to a user: it
 * exists for rows imported from the workbook, where the discount survived and
 * the reason did not, and it reports as a gap.
 */
export const WRITE_DOWN_REASONS = [
  "scope_creep", "under_quoted", "our_error", "client_relationship", "goodwill",
  // Hours past a capped fee (project.fee_ceiling). Distinct from under_quoted:
  // that one says the quote was wrong, this one says the cap did what it was
  // meant to and the overrun is the firm's.
  "fee_ceiling",
];

export const BILLING_BASES = ["fixed_fee", "time_and_materials"];

export const PROJECT_STATUSES = ["open", "on_hold", "halted", "complete"];
