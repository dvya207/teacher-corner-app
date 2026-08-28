import { LEARNING_UNIT_RESOURCE_SCHEMA } from './learning-unit-resource-schema';

/**
 * Turning a resource schema into the rows a tab renders.
 *
 * The schema is four levels deep — type -> maturity -> category -> slot — and
 * every resource tab shows ONE category of ONE maturity of ONE unit's type. This
 * module is the lookup and the naming, kept out of the form component because it
 * is neither, and because every tab beyond TACDev will want the same two calls.
 */

/** One row on a resource tab. */
export interface ResourceSlot {
  /** The schema key, and the key inside the stored resources map. */
  key: string;
  /** What the row is labelled. */
  label: string;
  /**
   * True where the schema's leaf is an object rather than a plain path, which
   * production's sheet marks isGradeDependent — the slot holds a fallback path
   * plus, sometimes, one per board.
   */
  gradeDependent: boolean;
  /** True where the slot is a pasted link rather than an uploaded file. */
  url: boolean;
}

/**
 * Labels the naive rule gets wrong.
 *
 * The rule below splits camelCase and title-cases it, which is right for
 * `variableMatrix` and wrong for anything carrying an acronym: `tacRDNotes`
 * would come out "Tac RD Notes". Only keys whose correct label cannot be derived
 * are listed here.
 *
 * VERIFIED AGAINST PRODUCTION'S OWN EDITOR, on the TACDev tab at Silver and at
 * Gold: 'TAC R&D Notes', 'Variable Matrix', 'Consolidated BoC', 'Consolidated
 * BoM', 'Dev Guide (PDF)', 'Dev Guide (Word)', 'Formative Assessment (Doc)',
 * 'Inference', 'Interpretation and Evaluation', 'Material List' and
 * 'Observation Filled Sample (PDF)'.
 *
 * TWO CONVENTIONS follow from those: a file format is PARENTHESISED — '(PDF)',
 * '(Word)', '(Doc)' — and a joining 'and' stays lowercase. The rest of this
 * table applies both, but is still this app's rendering rather than
 * production's, and should be corrected as more of its screens are seen. They
 * are labels only; changing one moves no data.
 */
const SLOT_LABELS: Readonly<Record<string, string>> = Object.freeze({
  tacRDNotes: 'TAC R&D Notes',
  // Graphics. The Gold nine are read off production's own tab; the Platinum and
  // Diamond ones follow their conventions.
  '3DConversion': '3D Conversion',
  dieTemplate: 'Die Template',
  headlineImage: 'Headline Image',
  label18Sticker: 'Label - 18 Sticker',
  qrCode: 'QR Code',
  tacGuideOnline: 'TAC Guide (Online)',
  tacGuidePrint: 'TAC Guide (Print)',
  tacIllustration: 'TAC Illustration',
  templates: 'Templates',
  labels4Sticker: 'Labels - 4 Sticker',
  tacGuideDiksha: 'TAC Guide (Diksha)',
  tacHandbook: 'TAC Handbook',
  variationLabel: 'Variation Label',
  // Social Media. The Gold and Silver pairs are read off production's own tab;
  // Diamond's follows them, and Platinum has no slots at all.
  tacVideoReelMp4: 'TAC Video Reel (MP4)',
  tacVideoReelProject: 'TAC Video Reel (Project)',
  tacVideoReel: 'TAC Video Reel',
  tacQuickVideoReelMp4: 'TAC Quick Video Reel (MP4)',
  tacQuickVideoReelProject: 'TAC Quick Video Reel (Project)',
  varVideoReelMp4: 'Var Video Reel (MP4)',
  varVideoReelProject: 'Var Video Reel (Project)',
  // The 3S tab. 'Quizzes (Dev)', 'TTT PPTs' and 'Teacher Notes' are read off
  // production's own Gold tab; the rest follow their conventions.
  quizzesDev: 'Quizzes (Dev)',
  quizzes: 'Quizzes',
  tttPpts: 'TTT PPTs',
  tttVideos: 'TTT Videos',
  teacherNotes: 'Teacher Notes',
  teacherNotesEE: 'Teacher Notes (EE)',
  teacherTrainingContent: 'Teacher Training Content',
  conceptConnectPpts: 'Concept Connect PPTs',
  liveSessionContent: 'Live Session Content',
  // An ampersand, as production writes it — not the word.
  problemStatementsSolutions21C: 'Problem Statements & Solutions (21C)',
  scamper: 'SCAMPER',
  conceptPreTestQuizPdf: 'Pre-Test Questionnaire',
  conceptPostTestQuizPdf: 'Post-Test Questionnaire',
  // The Video tab's six, read off production's own Gold tab.
  tacVideoDriveUrl: 'TAC Video (Drive URL)',
  tacVideoMp4: 'TAC Video (MP4)',
  tacVideoProject: 'TAC Video (Project)',
  tacVideoRaw: 'TAC Video (Raw)',
  tacVideoUrl: 'TAC Video (URL)',
  tacVideoWoS: 'TAC Video (WoS)',
  // The same six at Silver, where the slots are the QUICK video's.
  tacQuickVideoDriveUrl: 'TAC Quick Video (Drive URL)',
  tacQuickVideoMp4: 'TAC Quick Video (MP4)',
  tacQuickVideoProject: 'TAC Quick Video (Project)',
  tacQuickVideoRaw: 'TAC Quick Video (Raw)',
  tacQuickVideoUrl: 'TAC Quick Video (URL)',
  tacQuickVideoWoS: 'TAC Quick Video (WoS)',
  tacQuickVideoDev: 'TAC Quick Video (Dev)',
  formativeAssessmentDoc: 'Formative Assessment (Doc)',
  formativeAssesment: 'Formative Assessment',
  formativeAssesmentExplanation: 'Formative Assessment Explanation',
  interpretationAndEvaluation: 'Interpretation and Evaluation',
  predictionAndHypothesis: 'Prediction and Hypothesis',
  materialListLinks: 'Material List Links',
  variableMatrix: 'Variable Matrix',
  muTRDNotes: 'MuT R&D Notes',
  rdNotes: 'R&D Notes',
  'themeR&Dnotes': 'Theme R&D Notes',
  consolidatedBoC: 'Consolidated BoC',
  consolidatedBoM: 'Consolidated BoM',
  varBoM: 'Var BoM',
  variationBoM: 'Variation BoM',
  devGuidePdf: 'Dev Guide (PDF)',
  devGuideWord: 'Dev Guide (Word)',
  guidePdf: 'Guide (PDF)',
  materialListPdf: 'Material List (PDF)',
  mipGuidePdf: 'MIP Guide (PDF)',
  mipMaterialListPdf: 'MIP Material List (PDF)',
  mipVideoUrl: 'MIP Video URL',
  muTBlog: 'MuT Blog',
  muTFaq: 'MuT FAQ',
  muTQuickVideoUrl: 'MuT Quick Video URL',
  mutAssemblyGuidePdf: 'MuT Assembly Guide (PDF)',
  mutAssemblyGuideWord: 'MuT Assembly Guide (Word)',
  mutFa: 'MuT FA',
  mutFaq: 'MuT FAQ',
  observationFilledSamplePdf: 'Observation Filled Sample (PDF)',
  observationfilledSamplePdf: 'Observation Filled Sample (PDF)',
  observationFilledSampleWord: 'Observation Filled Sample (Word)',
  observationfilledSampleWord: 'Observation Filled Sample (Word)',
  observationSheetPdf: 'Observation Sheet (PDF)',
  observationWorksheetPdf: 'Observation Worksheet (PDF)',
  observationWorksheetWord: 'Observation Worksheet (Word)',
  readyTacGuidePdf: 'ReadyTAC Guide (PDF)',
  readyTacGuideWord: 'ReadyTAC Guide (Word)',
  taCtivityFaq: 'TACtivity FAQ',
  tactivityBlog: 'TACtivity Blog',
  tactivityFaq: 'TACtivity FAQ',
  tacFaExplanation: 'TAC FA Explanation',
  teacherReadinessMcqQuizPdf: 'Teacher Readiness MCQ Quiz (PDF)',
  toyGuidePdf: 'Toy Guide (PDF)',
  toyGuideWord: 'Toy Guide (Word)',
  variationVideoUrl: 'Variation Video URL',
  videoUrl: 'Video URL'
});

/**
 * A schema key as a human label.
 *
 * Splits on the camelCase boundary and capitalises, after the override table
 * above has had its say. A key that already reads as a label — production has a
 * few, such as 'TAC Quick Video (URL)' — passes through untouched, because the
 * split leaves a string containing a space alone.
 */
export function resourceSlotLabel(key: string): string {
  const override = SLOT_LABELS[key];

  if (override) {
    return override;
  }

  if (key.includes(' ')) {
    return key;
  }

  const spaced = key
    .replace(/(?<=[a-z0-9])(?=[A-Z])/g, ' ')
    .replace(/(?<=[A-Z])(?=[A-Z][a-z])/g, ' ');

  const titled = spaced.charAt(0).toUpperCase() + spaced.slice(1);

  // Acronyms the split leaves in title case. Applied after the split so 'Mp4'
  // and 'Url' come back as MP4 and URL rather than staying half-capitalised.
  return titled.replace(
    /\b(tac|mip|mut|tnt|ttt|mp4|url|pdf|faq|mcq|wos|fa|3s|rd|bom|boc)\b/gi,
    match => ACRONYMS[match.toLowerCase()] ?? match
  );
}

/** How each acronym is spelled once the split has broken it out. */
const ACRONYMS: Readonly<Record<string, string>> = Object.freeze({
  tac: 'TAC',
  mip: 'MIP',
  mut: 'MuT',
  tnt: 'TnT',
  ttt: 'TTT',
  mp4: 'MP4',
  url: 'URL',
  pdf: 'PDF',
  faq: 'FAQ',
  mcq: 'MCQ',
  wos: 'WoS',
  fa: 'FA',
  '3s': '3S',
  rd: 'R&D',
  bom: 'BoM',
  boc: 'BoC'
});

/**
 * Whether a slot holds a LINK rather than a file.
 *
 * Read off production's Video tab, where TAC Video (Drive URL), (Raw) and (URL)
 * are text boxes reading "Paste video URL" while (MP4), (Project) and (WoS) are
 * upload buttons. Two suffixes separate them: a slot ending in `Url` is a link,
 * and so is one ending in `Raw` — raw footage lives in Drive and is referenced,
 * not uploaded here.
 */
export function isUrlSlot(key: string): boolean {
  return /(?:url|raw)$/i.test(key);
}

/**
 * The schema's key for a learning unit type.
 *
 * The schema strips spaces — 'Toys and Tales' is keyed 'ToysandTales' — because
 * that is how production's generator emits it. A unit stores the spaced form, so
 * every lookup has to strip at the point of use.
 */
function schemaTypeKey(type: string): string {
  return String(type ?? '').replace(/\s+/g, '');
}

/**
 * One category's slots, for a type and maturity.
 *
 * Empty for every combination the schema does not carry, and that is a real
 * answer rather than a failure: a type absent from the schema has no resource
 * slots at all, and TACtivity's platinum genuinely has no socialMedia. The tab
 * renders an empty category as empty rather than inventing rows for it.
 *
 * Maturity is matched in lowercase — the schema keys it 'gold' where a unit's
 * own field carries 'Gold'.
 */
export function resourceSlotsFor(
  type: string,
  maturity: string,
  category: string
): ResourceSlot[] {
  const schema = LEARNING_UNIT_RESOURCE_SCHEMA as unknown as Record<
    string,
    Record<string, Record<string, Record<string, unknown>>>
  >;

  const slots =
    schema[schemaTypeKey(type)]?.[String(maturity ?? '').toLowerCase()]?.[category];

  if (!slots) {
    return [];
  }

  return Object.keys(slots).map(key => ({
    key,
    label: resourceSlotLabel(key),
    gradeDependent: typeof slots[key] === 'object' && slots[key] !== null,
    url: isUrlSlot(key)
  }));
}
