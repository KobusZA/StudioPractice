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
 * One canonical list. The workbook's timesheets carry two, differing by row
 * range, which is how the same afternoon gets filed under two names.
 */
export const ACTIVITY_TYPES = [
  "Phone call", "Report", "File work", "Meeting", "Site visit", "Admin",
  "Networking", "Town planning", "Architectural work", "Training", "Marketing",
  "Travel", "Print", "Daily huddle", "Friday club", "Excel work", "Other",
];

/**
 * Why value was given up. `legacy_unspecified` is not offered to a user: it
 * exists for rows imported from the workbook, where the discount survived and
 * the reason did not, and it reports as a gap.
 */
export const WRITE_DOWN_REASONS = [
  "scope_creep", "under_quoted", "our_error", "client_relationship", "goodwill",
];

export const BILLING_BASES = ["fixed_fee", "time_and_materials"];

export const PROJECT_STATUSES = ["open", "on_hold", "halted", "complete"];
