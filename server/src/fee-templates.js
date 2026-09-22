// The fee templates, as the workbook actually carries them.
//
// Every phase name, task description and figure below was read out of
// `TSP_TEAM TIME Tdummy.xlsm` rather than derived, because the point of
// seeding real content is that a new firm's first REZONING job arrives priced
// the way the firm already prices one. Where the workbook is internally
// inconsistent, the note beside the template says so and the inconsistency is
// not resolved here - see `STRATAREPORT` below.
//
// Three shapes, one schema (domain.md): `REZONING`, `CONSENT USE` and
// `REMOVAL OF RESTRICTIONS` are phases of numbered tasks with the fee on the
// phase; `TOWNSHIP establishment` is stages whose tasks each carry a fee;
// `STRATAREPORT` is a single phase. `BOQ`, `CONSTRUCTION COST JBCC`,
// `CONSOLIDATION` and `SUBDVISION` get nothing at all, which is the settled
// decision that a stub type stays fully usable - a job of that type keeps the
// freehand fee schedule instead.
//
// What is deliberately absent: hours and rate bands. The sheets carry an hours
// column that disagrees with its own phase subtotals (CONSENT USE task 1 reads
// "4 hours @ R3 600" beside cells holding 2 and 1), so `default_hours` and
// `rate_band_code` stay null until the firm authors them rather than being
// filled with a number nobody can source.

/**
 * The twenty-one steps in the spatial planning process, shared verbatim by the
 * REZONING and CONSENT USE sheets. One list rather than two copies, because
 * they are the same list - the sheets differ only in what each phase is worth.
 */
const SPATIAL_PLANNING_PHASES = [
  [
    "Briefing session with client: taking instructions",
    "Registration of project, site visit, and land-use survey",
    "Brief staff and liaise with other consultants (traffic, services, conveyancing, geotechnical, etc.)",
  ],
  [
    "Collection and evaluation of documents (title deeds, SG diagrams, zoning certificates, policy guidelines, etc.)",
    "Collation of application documents and preparation of maps/plans to accompany application",
    "Meet/liaise with client and professional team to verify application details before submission to authorities",
    "Preparation, verification, and submission of notices (Gazette/Newspapers, etc.)",
    "Finalization of application memorandum and land-use zoning documents",
    "Copying/collation of application bundles ready for submission",
    "Submission of application bundles and procuring authorization to give notice to interested/affected parties",
  ],
  [
    "Monitor mandatory notice period, receipt and evaluation of objections/representations",
    "Meeting/liaison with client and professional team (where appropriate) to take instructions on responding to objections/representations",
    "Prepare written response report and submit to authority",
  ],
  [
    "Engage with municipal departments to procure technical comments/recommendations/authorizations",
    "Engage with other authorities/service providers to procure technical comments/recommendations/authorizations",
    "Receipt, perusal of, and report to client regarding departmental comments, bulk engineering calculations",
    "Meet/liaise with client and project team (where relevant) to agree on responses to technical comments/recommendations of municipal divisions/other authorities/service providers",
    "Obtain and forward letter of approval to client and project team and prepare report on post-approval formalities",
  ],
  [
    "Prepare amendment scheme documents/maps/annexures for enactment/promulgation and submit to authority",
    "Arrange/facilitate publication of promulgation notice (Gazette)",
    "Deliver approval notice to client and project team member where applicable and prepare close-out report dealing with any unresolved matters (i.e., services contributions)",
  ],
];

const spatialPlanning = (names, fees) => names.map((name, index) => ({
  name,
  fee: fees[index],
  tasks: SPATIAL_PLANNING_PHASES[index].map((description) => ({ description })),
}));

/**
 * Keyed by `project_type.code`. A type absent from here seeds no phases, which
 * is the placeholder case and is not an error.
 */
export const FEE_TEMPLATES = {
  // Sheet 'REZONING', J40: R74 500 professional, over five phases. Its
  // R26 250 of council fees, advertising and ancillary costs (J51) are
  // disbursements rather than phases and are not seeded - `Disbursement` is
  // its own entity in domain.md and is not built yet.
  REZONING: {
    source: "Sheet 'REZONING', phase fees J10/J15/J24/J29/J36, total J40",
    phases: spatialPlanning(
      [
        "1 - Inception",
        "2 - Submission to authorities",
        "3 - Public participation",
        "4 - Procuring decision",
        "5 - Promulgation",
      ],
      [15000, 30000, 14000, 7000, 8500],
    ),
  },

  // Sheet 'CONSENT USE', H44: R39 000 professional. The sheet's own sub-total
  // of R51 310 (H45) adds an application-fee allowance of R2 310 and an
  // advertising allowance of R10 000, neither of which is work this practice
  // does; measuring captured time against the larger figure would flatter
  // every burn on the job.
  "CONSENT USE": {
    source: "Sheet 'CONSENT USE', phase fees H11/H16/H25/H30/H37, professional total H44",
    phases: spatialPlanning(
      [
        "Phase 1 - Inception",
        "Phase 2 - Submission to authorities",
        "Phase 3 - Public participation",
        "Phase 4 - Procuring decision",
        "Phase 5 - Promulgation",
      ],
      [7500, 20000, 5000, 5000, 1500],
    ),
  },

  // Sheet 'REMOVAL OF RESTRICTIONS', J47: R30 000 professional over eight
  // phases. Its R15 820 of other charges (J58) are disbursements, as above.
  "REMOVAL OF RESTRICTIONS": {
    source: "Sheet 'REMOVAL OF RESTRICTIONS', phase fees J10 through J44, total J47",
    phases: [
      {
        name: "Briefing / inception",
        fee: 5000,
        tasks: [
          "Briefing session with client: taking instructions",
          "Open project file, confirm application route, define scope and deliverables",
          "Digital site analysis and preliminary land use/contextual review",
          "Procure and review available property information and background material supplied by client",
        ].map((description) => ({ description })),
      },
      {
        name: "Title & planning due diligence",
        fee: 5000,
        tasks: [
          "Review title deed restrictions and identify the specific conditions requiring removal/amendment/suspension",
          "Review zoning, development controls, approved plans, SG diagram/general plan extract, and relevant planning context",
          "Determine whether the proposal can proceed as a standalone restrictive conditions application or whether a related land use application may also be required",
          "Liaison with conveyancer regarding title implications and wording of restrictive conditions",
          "Liaison regarding bondholder consent where applicable",
        ].map((description) => ({ description })),
      },
      {
        name: "Pre-application strategy",
        fee: 5000,
        tasks: [
          "Initial engagement with the relevant district planning office/City official where advisable",
          "Confirm application strategy, supporting documents and anticipated procedural steps",
          "Meeting/liaison with client and professional team to align proposal details and required deliverables",
        ].map((description) => ({ description })),
      },
      {
        name: "Application bundle preparation",
        fee: 5000,
        tasks: [
          "Draft statutory planning motivation/memorandum in support of the removal/amendment/suspension of restrictive conditions",
          "Compile supporting annexures, including title documents, SG diagram/extract, conveyancer documentation, bondholder consent where applicable, and client authority documentation",
          "Prepare/coordinate locality plan, site plan, cadastral context plan and any supporting layout or SDP-type plan required for submission",
          "Internal review, refinement and quality control of application documents",
          "Client review process and finalisation of application bundle for submission",
        ].map((description) => ({ description })),
      },
      {
        name: "Submission to authority",
        fee: 2500,
        tasks: [
          "Final collation, copying/PDF packaging and formal submission to the authority",
          "Attend to completeness/validation queries and supply additional administrative information if requested at intake stage",
        ].map((description) => ({ description })),
      },
      {
        name: "Statutory notice / comment",
        fee: 2500,
        tasks: [
          "Preparation and coordination of statutory notification documentation where required",
          "Monitoring of notice period and receipt of comments/objections/representations",
          "Assessment of comments/objections/representations received",
          "Consultation with client and professional team regarding response strategy",
          "Preparation of written response report and submission to the authority",
        ].map((description) => ({ description })),
      },
      {
        name: "Municipal process management",
        fee: 2500,
        tasks: [
          "Follow-up with case officer/departments and management of the application through the assessment process",
          "Receipt, perusal and reporting on departmental comments and procedural requirements",
          "Procurement of final decision and written report to client on approval/refusal and conditions",
        ].map((description) => ({ description })),
      },
      {
        name: "Post-approval formalities",
        fee: 2500,
        tasks: [
          "Arrange/facilitate publication steps in respect of the Provincial Gazette notice, where applicable to the approval",
          "Prepare handover pack for conveyancer/Deeds process, including approval letter and post-approval requirements",
          "Liaison regarding Deeds endorsement and final close-out reporting to client",
        ].map((description) => ({ description })),
      },
    ],
  },

  // Sheet 'TOWNSHIP establishment', C69: R54 445.80 over five stages plus
  // sundries - the D063 job. Shape C, where the fee sits on each task and the
  // stage total is their sum, so the stage fees below are derived from the
  // tasks and a test asserts they still agree with the sheet's own C13/C36/
  // C44/C50/C52/C57.
  //
  // The travel and toll lines are the firm's own, priced in the quote. They
  // are not the unimplemented travel/print auto-billing of the timesheet.
  "TOWNSHIP establishment": {
    source: "Sheet 'TOWNSHIP establishment', stage totals C13/C36/C44/C50/C52/C57, total C69",
    phases: [
      {
        name: "Stage 1 - Inception & preparation",
        fee: 23415.2,
        tasks: [
          ["Obtain copy of Zoning Certificate", 350],
          // The sheet prices the title deed as "Provided" rather than as a
          // number. Zero, not omitted: somebody still has to obtain it.
          ["Obtain copy of Title Deed (provided by client)", 0],
          ["Obtain copy of SG Diagram", 150],
          ["Obtain copy of Locality Map", 85],
          ["Confirmation of existing building plans", 0],
          ["Interpretation of existing zoning", 1250],
          ["Site inspection (first visit)", 1750],
          ["Travel - site inspection", 525],
          ["Toll fees - site inspection", 43.4],
          ["Meet with Department", 1750],
          ["Travel - meeting with Department", 525],
          ["Toll fees - meeting with Department", 43.4],
          ["Meet with Engineer on site", 1750],
          ["Travel - meeting with Engineer", 525],
          ["Toll fees - meeting with Engineer", 43.4],
          ["Prepare letter to DACEL", 1750],
          ["Deal with emails etc", 875],
          ["Study documents including Title Deed", 0],
          ["Assist land surveyor in compiling contour plan by providing the necessary information", 0],
          ["Land surveyor cost for contours", 12000],
        ].map(([description, fee]) => ({ description, fee })),
      },
      {
        name: "Stage 2 - Site measurement & scaling",
        fee: 8350,
        tasks: [
          ["Site measurement", 1950],
          ["Scaling of building", 0],
          ["Scale out in REVIT", 2850],
          ["Prepare preliminary technical drawings for approval", 1500],
          ["Obtain inputs from Engineer and finalise plan", 650],
          ["Emails, telephone calls etc", 150],
          ["Building line relaxation - documentation and application (three)", 1250],
        ].map(([description, fee]) => ({ description, fee })),
      },
      {
        name: "Stage 3 - Engineering & SANS forms",
        fee: 4350,
        tasks: [
          ["Refer to Engineer as per requirement of local authority", 0],
          ["Engineers fee including professional indemnity", 2200],
          ["Prepare SANS 10400 Forms 1-3 documentation", 650],
          ["Additional work as requested by Council - fenestration report", 1500],
        ].map(([description, fee]) => ({ description, fee })),
      },
      {
        name: "Stage 4 - Runner / council submission",
        fee: 4000,
        tasks: [
          ["Appoint runner to take plans through local authority", 4000],
        ].map(([description, fee]) => ({ description, fee })),
      },
      {
        name: "Stage 5 - Comments & handover",
        fee: 900,
        tasks: [
          ["Deal with all comments from local authority", 0],
          ["Obtain approved plans and provide to client", 450],
          ["Provide document to client", 450],
        ].map(([description, fee]) => ({ description, fee })),
      },
      {
        name: "Sundries",
        fee: 13430.6,
        tasks: [
          ["Travel & communication", 750],
          ["Neighbour consent for encroachment application", 450],
          ["Legal - application", 1000],
          ["Resign documentation (see additional prints)", 450],
          ["Submit plans to Authority for approval", 1804],
          ["Direct cost to client at R20 per sqm (allowance)", 5740],
          ["Building line relaxation application", 1000],
          ["Additional application to legal", 1000],
          ["Cost for plan copies - office copy plus three reprints for Council", 1236.6],
        ].map(([description, fee]) => ({ description, fee })),
      },
    ],
  },

  // Sheet 'STRATAREPORT'. Shape A: one phase, fee-only lines, and the only
  // three rows on the sheet carrying a figure.
  //
  // The sheet's own total is R1 100, from `=SUM(J6:J7)` - a range that stops
  // one row short and drops the R850 external reports line. The three items
  // are seeded at their own figures and the phase is their sum, R1 950,
  // because a template whose phase fee disagreed with its own tasks would put
  // the fee schedule and the task list at odds on the day the job is opened.
  // The workbook is not corrected; this is a template authored from it, and
  // the firm can edit either number.
  STRATAREPORT: {
    source: "Sheet 'STRATAREPORT', items J6/J7/J8 (its own total J32 omits J8)",
    phases: [
      {
        name: "Strata report",
        fee: 1950,
        tasks: [
          ["Documents from Council", 750],
          ["Title Deed", 350],
          ["External reports", 850],
        ].map(([description, fee]) => ({ description, fee })),
      },
    ],
  },
};

/** The fraction of the template's professional fee this phase carries. */
export function pctSplit(phase, total) {
  if (!total) return null;
  return Math.round((phase.fee / total) * 10000) / 10000;
}

export function templateTotal(template) {
  return Math.round(template.phases.reduce((sum, phase) => sum + phase.fee, 0) * 100) / 100;
}
