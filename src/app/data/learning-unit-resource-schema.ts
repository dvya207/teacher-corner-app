/**
 * `Configuration/learningUnitResourceSchema.resources` — production's document, verbatim.
 *
 * WHAT IT IS. The EMPTY SKELETON a new LearningUnitResources document is stamped from.
 * Creating a learning unit expands its chosen maturity into a cumulative ladder (see
 * LEARNING_UNIT_MATURITY_LADDER) and creates one resource document per rung, each
 * initialised from `resources[<type>][<maturity>]` — so this table decides which
 * upload slots a unit of a given type and maturity even has.
 *
 * FOUR LEVELS DEEP: type -> maturity -> category -> sub-category -> stored path.
 *
 *   resources.TACtivity.gold.video.tacVideoMp4        = ''
 *   resources.TACtivity.gold['3S'].teacherNotes       = { universalGradeBoardResourcePath: '' }
 *
 * TWO LEAF SHAPES, and the difference is load-bearing. A plain `''` is one path for the
 * whole unit. A `{ universalGradeBoardResourcePath: '' }` is a GRADE-DEPENDENT slot —
 * production's sheet marks the field isGradeDependent, and the generator emits this
 * object instead of a string so per-grade paths can be hung off it later.
 *
 * TYPE KEYS HAVE THEIR SPACES STRIPPED, which is why they read oddly: 'ToysandTales',
 * 'MicroImprovementProgramme', 'Keep@Home', 'CBETheme'. The learning unit stores
 * `type` with spaces ('Toys and Tales') and the lookup strips them at the point of use.
 *
 * NINE TYPES, not the thirteen Configuration/LearningUnitTypes defines. A type absent
 * here gets no resource slots at all. TWO OF THE NINE ARE EMPTY — 'GroupActivity' and
 * 'Keep@Home' are declared with no maturities, so they are known-but-unpopulated rather
 * than missing.
 *
 * NOT EVERY TYPE HAS ALL FOUR MATURITIES' CATEGORIES ALIGNED, and the gaps are real
 * data rather than transcription slips: TACtivity's diamond has no `3S` and its platinum
 * no `socialMedia`; ToysandTales' diamond has no `socialMedia`. MuT and ReadyTAC hang a
 * grade-dependent handbook at CATEGORY level ('muTHandbook', 'mutHandbook',
 * 'tacHandbook', 'handbook') rather than inside `graphics`, and MuT spells it two
 * different ways across two maturities.
 *
 * TYPOS AND CASING ARE PRESERVED, deliberately, because this seeds a document other
 * apps read and a "correction" here would silently disagree with them:
 *
 *   extensionActivtiesWord          missing an 'i'
 *   formativeAssesment(Explanation) one 's'
 *   simulationGamesbasedquesions    two typos in one key
 *   themeR&Dnotes                   an ampersand mid-key
 *   tntQuickVideoWos  /  tacQuickVideoWoS      different capitalisation, same suffix
 *   observationfilledSamplePdf  /  observationFilledSamplePdf   differs across types
 *   3dConversion (MuT)  /  3DConversion (TACtivity)
 *   'cbeAssertionReasonQs (Print)'  /  'TAC Quick Video (URL)'  spaces and parentheses
 *
 * THE SOURCE OF TRUTH IS A GOOGLE SHEET, not this file and not Firestore. Production's
 * document records `updatedBy: "Google Sheet 'Lu Content List to Firestore Mapping'"`
 * and an Apps Script pushes the whole grid through a Cloud Function that rewrites the
 * document with a plain set(). This copy is a snapshot of the 7 July 2025 push.
 */

export const LEARNING_UNIT_RESOURCE_SCHEMA = {
  CBETheme: {
    diamond: {
      '3S': {},
      graphics: {},
      socialMedia: {},
      tq: {
        additionalLearningSectionsAls: '',
        explorationPathway: '',
        gameDesign: '',
        simulationGamesbasedquesions: '',
        taCtivityFaq: '',
        tacFaExplanation: '',
        varBoM: '',
        varVideo: ''
      },
      video: {}
    },
    gold: {
      '3S': {
        teacherTrainingContent: ''
      },
      graphics: {
        cbeTest: { universalGradeBoardResourcePath: '' },
        finalBookPdf: ''
      },
      socialMedia: {},
      tq: {
        cbeAnswerKeysPrint: '',
        'cbeAssertionReasonQs (Print)': '',
        cbeCaseStudyPrint: '',
        goalAnswerDev: ''
      },
      video: {}
    },
    platinum: {
      '3S': {
        liveSessionContent: ''
      },
      graphics: {},
      socialMedia: {},
      tq: {
        abridgedGoalAnswers: '',
        abridgedGoalVideo: '',
        conceptAdequacyQuiz: ''
      },
      video: {}
    },
    silver: {
      '3S': {},
      graphics: {},
      socialMedia: {},
      tq: {
        'cbeAssertionReasonQs (Print)': '',
        cbeAssertionReasonQsDev: '',
        cbeCaseStudyDev: '',
        cbeThemeDev: ''
      },
      video: {}
    }
  },
  FLN: {
    diamond: {
      '3S': {},
      graphics: {},
      socialMedia: {},
      tacDev: {},
      tnt: {},
      video: {}
    },
    gold: {
      '3S': {},
      graphics: {
        dieTemplate: '',
        headlineImage: '',
        label18Sticker: '',
        qrCode: '',
        templates: '',
        toyGuidePrint: '',
        toyIllustration: ''
      },
      socialMedia: {
        tntVideoReelMp4: '',
        tntVideoReelProject: ''
      },
      tacDev: {
        consolidatedBoC: { universalGradeBoardResourcePath: '' },
        consolidatedBoM: { universalGradeBoardResourcePath: '' },
        toyGuidePdf: '',
        toyGuideWord: ''
      },
      tnt: {
        aeroWorksheet: '',
        boatWorksheet: '',
        consolidatedThemePdf: '',
        instructionsPdf: '',
        instructionsStep1: '',
        instructionsStep2: '',
        instructionsStep3: '',
        instructionsStep4: '',
        instructionsStep5: '',
        loList: '',
        ppWorksheetDev: '',
        rubrics: '',
        talePdf: ''
      },
      video: {
        tntQuickVideoMp4: '',
        tntQuickVideoProject: '',
        tntQuickVideoRaw: '',
        tntQuickVideoUrl: '',
        tntQuickVideoWos: ''
      }
    },
    platinum: {
      '3S': {},
      graphics: {
        toyHandbook: ''
      },
      socialMedia: {},
      tacDev: {
        packingPhoto: '',
        translationFileGuide: '',
        translationFileMaterialList: ''
      },
      tnt: {
        extensionActivitiesPdf: '',
        extensionActivtiesWord: '',
        teacherNotes: '',
        tntHpc: ''
      },
      video: {}
    },
    silver: {
      '3S': {},
      graphics: {},
      socialMedia: {},
      tacDev: {
        'themeR&Dnotes': ''
      },
      tnt: {},
      video: {}
    }
  },
  GroupActivity: {},
  'Keep@Home': {},
  MicroImprovementProgramme: {
    diamond: {
      '3S': {},
      conceptPostTestQuizPdf: { universalGradeBoardResourcePath: '' },
      conceptPreTestQuizPdf: { universalGradeBoardResourcePath: '' },
      graphics: {},
      socialMedia: {},
      tacDev: {
        guidePdf: '',
        materialListPdf: '',
        mipGuidePdf: '',
        mipMaterialListPdf: '',
        mipVideoUrl: '',
        observationSheetPdf: '',
        teacherReadinessMcqQuizPdf: '',
        videoUrl: ''
      },
      video: {},
      videoRecordingUrl: { universalGradeBoardResourcePath: '' }
    },
    gold: {
      '3S': {},
      conceptPostTestQuizPdf: { universalGradeBoardResourcePath: '' },
      conceptPreTestQuizPdf: { universalGradeBoardResourcePath: '' },
      graphics: {},
      socialMedia: {},
      tacDev: {
        guidePdf: '',
        materialListPdf: '',
        mipGuidePdf: '',
        mipMaterialListPdf: '',
        mipVideoUrl: '',
        observationSheetPdf: '',
        teacherReadinessMcqQuizPdf: '',
        videoUrl: ''
      },
      video: {},
      videoRecordingUrl: { universalGradeBoardResourcePath: '' }
    },
    platinum: {
      '3S': {},
      conceptPostTestQuizPdf: { universalGradeBoardResourcePath: '' },
      conceptPreTestQuizPdf: { universalGradeBoardResourcePath: '' },
      graphics: {},
      socialMedia: {},
      tacDev: {
        guidePdf: '',
        materialListPdf: '',
        mipGuidePdf: '',
        mipMaterialListPdf: '',
        mipVideoUrl: '',
        observationSheetPdf: '',
        teacherReadinessMcqQuizPdf: '',
        videoUrl: ''
      },
      video: {},
      videoRecordingUrl: { universalGradeBoardResourcePath: '' }
    },
    silver: {
      '3S': {},
      conceptPostTestQuizPdf: { universalGradeBoardResourcePath: '' },
      conceptPreTestQuizPdf: { universalGradeBoardResourcePath: '' },
      graphics: {},
      socialMedia: {},
      tacDev: {
        guidePdf: '',
        materialListPdf: '',
        mipGuidePdf: '',
        mipMaterialListPdf: '',
        mipVideoUrl: '',
        observationSheetPdf: '',
        teacherReadinessMcqQuizPdf: '',
        videoUrl: ''
      },
      video: {},
      videoRecordingUrl: { universalGradeBoardResourcePath: '' }
    }
  },
  MuT: {
    diamond: {
      '3S': {
        tttVideos: ''
      },
      graphics: {},
      muTHandbook: { universalGradeBoardResourcePath: '' },
      socialMedia: {},
      tacDev: {
        explorationPathway: '',
        formativeAssesmentExplanation: '',
        muTBlog: '',
        mutFaq: ''
      },
      video: {}
    },
    gold: {
      '3S': {
        conceptConnectPpts: '',
        quizzes: { universalGradeBoardResourcePath: '' }
      },
      graphics: {
        '3dConversion': '',
        dieTemplate: '',
        headlineImage: '',
        label18Sticker: { universalGradeBoardResourcePath: '' },
        muTGuideOnline: '',
        muTGuidePrint: '',
        muTIllustration: '',
        mutAssemblyGuideOnline: '',
        mutAssemblyGuidePrint: '',
        qrCode: '',
        templates: ''
      },
      socialMedia: {},
      tacDev: {
        consolidatedBoC: { universalGradeBoardResourcePath: '' },
        consolidatedBoM: { universalGradeBoardResourcePath: '' },
        devGuidePdf: '',
        devGuideWord: '',
        formativeAssessmentDoc: { universalGradeBoardResourcePath: '' },
        materialList: '',
        mutAssemblyGuidePdf: '',
        mutAssemblyGuideWord: '',
        observationFilledSample: { universalGradeBoardResourcePath: '' },
        observationWorksheet: { universalGradeBoardResourcePath: '' },
        observationWorksheetPdf: { universalGradeBoardResourcePath: '' },
        observationWorksheetWord: { universalGradeBoardResourcePath: '' },
        observationfilledSamplePdf: { universalGradeBoardResourcePath: '' },
        observationfilledSampleWord: { universalGradeBoardResourcePath: '' },
        placard: { universalGradeBoardResourcePath: '' }
      },
      video: {
        muTVideoMp4: '',
        muTVideoUrl: ''
      }
    },
    platinum: {
      '3S': {},
      graphics: {},
      mutHandbook: { universalGradeBoardResourcePath: '' },
      socialMedia: {},
      tacDev: {
        formativeAssesment: '',
        formativeAssessmentDoc: { universalGradeBoardResourcePath: '' },
        materialListLinks: '',
        muTFaq: '',
        mutFa: { universalGradeBoardResourcePath: '' },
        translationFile: ''
      },
      video: {}
    },
    silver: {
      '3S': {},
      graphics: {},
      socialMedia: {
        muTQuickVideoReelMp4: '',
        muTQuickVideoReelProject: ''
      },
      tacDev: {
        muTQuickVideoUrl: '',
        muTRDNotes: '',
        variableMatrix: ''
      },
      video: {
        muTQuickVideoDev: '',
        muTQuickVideoMp4: '',
        muTQuickVideoProject: '',
        muTQuickVideoRaw: '',
        muTQuickVideoWoS: ''
      }
    }
  },
  ReadyTAC: {
    diamond: {
      '3S': {
        teacherNotesEE: ''
      },
      graphics: {},
      tacHandbook: { universalGradeBoardResourcePath: '' },
      socialMedia: {},
      tacDev: {
        explorationPathway: '',
        gameDesign: '',
        taCtivityFaq: '',
        tacFaExplanation: '',
        varBoM: '',
        varVideo: ''
      },
      video: {}
    },
    gold: {
      '3S': {
        teacherNotes: { universalGradeBoardResourcePath: '' },
        teacherNotesEE: ''
      },
      graphics: {
        dieTemplate: '',
        headlineImage: '',
        label18Sticker: '',
        qrCode: '',
        templates: ''
      },
      socialMedia: {},
      tacDev: {
        consolidatedBoM: { universalGradeBoardResourcePath: '' },
        materialList: '',
        readyTacGuidePdf: '',
        readyTacGuideWord: ''
      },
      video: {}
    },
    platinum: {
      '3S': {},
      handbook: { universalGradeBoardResourcePath: '' },
      graphics: {},
      socialMedia: {},
      tacDev: {
        packingPhoto: ''
      },
      video: {}
    },
    silver: {
      '3S': {},
      graphics: {},
      socialMedia: {},
      tacDev: {
        'TAC Quick Video (URL)': '',
        rdNotes: ''
      },
      video: {
        tacQuickVideoDev: '',
        tacQuickVideoProject: '',
        tacQuickVideoRaw: '',
        tacQuickVideoWoS: ''
      }
    }
  },
  TACtivity: {
    diamond: {
      graphics: {
        variationLabel: ''
      },
      socialMedia: {
        varVideoReelMp4: '',
        varVideoReelProject: ''
      },
      tacDev: {
        explorationPathway: { universalGradeBoardResourcePath: '' },
        formativeAssesmentExplanation: '',
        gameDesign: '',
        interpretationAndEvaluation: { universalGradeBoardResourcePath: '' },
        tactivityBlog: '',
        tactivityFaq: '',
        variationBoM: '',
        variationVideoUrl: ''
      },
      video: {
        tacVideoDriveUrl: '',
        tttVideoMp4: '',
        tttVideoProject: '',
        tttVideoRaw: '',
        tttVideosUrl: '',
        varVideoMp4: '',
        varVideoProject: '',
        varVideoRaw: '',
        varVideoUrl: '',
        varVideoWoS: ''
      }
    },
    gold: {
      /*
       * SIX SLOTS, NOT THREE, and in production's own order.
       *
       * The sheet this file was generated from carries three; production's Gold
       * 3S tab renders six, adding a pre- and post-test questionnaire and
       * SCAMPER. Added here from the tab itself, because the tab is what a TAC
       * author works against and three of the six were unreachable without them.
       *
       * All six are grade-dependent: not one carries a copy button in
       * production, which is the tell — a plain path gets one and a per-board
       * bag does not. Contrast platinum below, whose single slot is a plain path
       * and does show the button.
       *
       * ORDERED as production lists them, which is not alphabetical by key:
       * tttPpts comes before teacherNotes. Left in that order deliberately, so
       * the columns read the same in both apps.
       */
      '3S': {
        conceptPostTestQuizPdf: { universalGradeBoardResourcePath: '' },
        conceptPreTestQuizPdf: { universalGradeBoardResourcePath: '' },
        quizzesDev: { universalGradeBoardResourcePath: '' },
        scamper: { universalGradeBoardResourcePath: '' },
        tttPpts: { universalGradeBoardResourcePath: '' },
        teacherNotes: { universalGradeBoardResourcePath: '' }
      },
      graphics: {
        '3DConversion': '',
        dieTemplate: '',
        headlineImage: '',
        label18Sticker: { universalGradeBoardResourcePath: '' },
        qrCode: '',
        tacGuideOnline: '',
        tacGuidePrint: '',
        tacIllustration: '',
        templates: ''
      },
      socialMedia: {
        tacVideoReelMp4: '',
        tacVideoReelProject: ''
      },
      tacDev: {
        consolidatedBoC: { universalGradeBoardResourcePath: '' },
        consolidatedBoM: { universalGradeBoardResourcePath: '' },
        devGuidePdf: '',
        devGuideWord: '',
        formativeAssessmentDoc: { universalGradeBoardResourcePath: '' },
        inference: { universalGradeBoardResourcePath: '' },
        interpretationAndEvaluation: { universalGradeBoardResourcePath: '' },
        materialList: { universalGradeBoardResourcePath: '' },
        observationFilledSamplePdf: { universalGradeBoardResourcePath: '' },
        observationFilledSampleWord: { universalGradeBoardResourcePath: '' },
        observationWorksheetPdf: { universalGradeBoardResourcePath: '' },
        observationWorksheetWord: { universalGradeBoardResourcePath: '' },
        predictionAndHypothesis: { universalGradeBoardResourcePath: '' }
      },
      video: {
        tacVideoDriveUrl: '',
        tacVideoMp4: '',
        tacVideoProject: '',
        tacVideoRaw: '',
        tacVideoUrl: '',
        tacVideoWoS: ''
      }
    },
    platinum: {
      '3S': {
        problemStatementsSolutions21C: ''
      },
      graphics: {
        labels4Sticker: '',
        tacGuideDiksha: '',
        tacHandbook: { universalGradeBoardResourcePath: '' }
      },
      tacDev: {
        formativeAssesment: { universalGradeBoardResourcePath: '' },
        formativeAssessmentDoc: { universalGradeBoardResourcePath: '' },
        inference: { universalGradeBoardResourcePath: '' },
        interpretationAndEvaluation: { universalGradeBoardResourcePath: '' },
        packingPhoto: '',
        predictionAndHypothesis: { universalGradeBoardResourcePath: '' },
        translationFileGuide: ''
      },
      video: {
        tacVideoDriveUrl: '',
        tacVideoMp4: '',
        tacVideoProject: '',
        tacVideoRaw: '',
        tacVideoUrl: '',
        tacVideoWoS: ''
      }
    },
    silver: {
      '3S': {},
      graphics: {},
      socialMedia: {
        tacQuickVideoReelMp4: '',
        tacQuickVideoReelProject: ''
      },
      tacDev: {
        tacRDNotes: '',
        variableMatrix: ''
      },
      video: {
        tacQuickVideoDriveUrl: '',
        tacQuickVideoMp4: '',
        tacQuickVideoProject: '',
        tacQuickVideoRaw: '',
        tacQuickVideoUrl: '',
        tacQuickVideoWoS: ''
      }
    }
  },
  ToysandTales: {
    diamond: {
      '3S': {},
      graphics: {
        dieTemplate: '',
        headlineImage: '',
        label18Sticker: '',
        qrCode: '',
        templates: '',
        toyGuideOnline: '',
        toyGuidePrint: '',
        toyHandbook: '',
        toyIllustration: ''
      },
      tacDev: {
        consolidatedBoC: { universalGradeBoardResourcePath: '' },
        consolidatedBoM: { universalGradeBoardResourcePath: '' },
        materialList: '',
        packingPhoto: '',
        'themeR&Dnotes': '',
        toyGuidePdf: '',
        toyGuideWord: '',
        translationFileGuide: '',
        translationFileMaterialList: ''
      },
      tnt: {
        aeroWorksheet: '',
        boatWorksheet: '',
        consolidatedThemePdf: '',
        instructionsPdf: '',
        instructionsStep1: '',
        instructionsStep2: '',
        instructionsStep3: '',
        instructionsStep4: '',
        instructionsStep5: '',
        instructionsStep6: '',
        loList: '',
        ppWorksheetDev: '',
        rubrics: '',
        talePdf: '',
        extensionActivitiesPdf: '',
        extensionActivtiesWord: '',
        teacherNotes: '',
        tntHpc: ''
      },
      video: {
        tntQuickVideoMp4: '',
        tntQuickVideoProject: '',
        tntQuickVideoRaw: '',
        tntQuickVideoUrl: '',
        tntQuickVideoWos: ''
      }
    },
    gold: {
      '3S': {},
      graphics: {
        dieTemplate: '',
        headlineImage: '',
        label18Sticker: '',
        qrCode: '',
        templates: '',
        toyGuideOnline: '',
        toyGuidePrint: '',
        toyIllustration: ''
      },
      socialMedia: {
        tntVideoReelMp4: '',
        tntVideoReelProject: ''
      },
      tacDev: {
        consolidatedBoC: { universalGradeBoardResourcePath: '' },
        consolidatedBoM: { universalGradeBoardResourcePath: '' },
        materialList: '',
        'themeR&Dnotes': '',
        toyGuidePdf: '',
        toyGuideWord: ''
      },
      tnt: {
        aeroWorksheet: '',
        boatWorksheet: '',
        consolidatedThemePdf: '',
        instructionsPdf: '',
        instructionsStep1: '',
        instructionsStep2: '',
        instructionsStep3: '',
        instructionsStep4: '',
        instructionsStep5: '',
        instructionsStep6: '',
        loList: '',
        ppWorksheetDev: '',
        rubrics: '',
        talePdf: ''
      },
      video: {
        tntQuickVideoMp4: '',
        tntQuickVideoProject: '',
        tntQuickVideoRaw: '',
        tntQuickVideoUrl: '',
        tntQuickVideoWos: ''
      }
    },
    platinum: {
      '3S': {},
      graphics: {
        dieTemplate: '',
        headlineImage: '',
        label18Sticker: '',
        qrCode: '',
        templates: '',
        toyGuideOnline: '',
        toyGuidePrint: '',
        toyHandbook: '',
        toyIllustration: ''
      },
      socialMedia: {
        tntVideoReelMp4: '',
        tntVideoReelProject: ''
      },
      tacDev: {
        consolidatedBoC: { universalGradeBoardResourcePath: '' },
        consolidatedBoM: { universalGradeBoardResourcePath: '' },
        materialList: '',
        packingPhoto: '',
        'themeR&Dnotes': '',
        toyGuidePdf: '',
        toyGuideWord: '',
        translationFileGuide: '',
        translationFileMaterialList: ''
      },
      tnt: {
        aeroWorksheet: '',
        boatWorksheet: '',
        consolidatedThemePdf: '',
        instructionsPdf: '',
        instructionsStep1: '',
        instructionsStep2: '',
        instructionsStep3: '',
        instructionsStep4: '',
        instructionsStep5: '',
        instructionsStep6: '',
        loList: '',
        ppWorksheetDev: '',
        rubrics: '',
        talePdf: '',
        extensionActivitiesPdf: '',
        extensionActivtiesWord: '',
        teacherNotes: '',
        tntHpc: ''
      },
      video: {
        tntQuickVideoMp4: '',
        tntQuickVideoProject: '',
        tntQuickVideoRaw: '',
        tntQuickVideoUrl: '',
        tntQuickVideoWos: ''
      }
    },
    silver: {
      '3S': {},
      graphics: {},
      socialMedia: {},
      tacDev: {
        'themeR&Dnotes': ''
      },
      tnt: {},
      video: {}
    }
  }
} as const;
