import { validateAgainstSchema } from './json-schema'

type JsonObject = Record<string, any>

type ExtractionResult = {
  signaturePhrases: string[]
  slangTokens: string[]
  emotionalTone: string
  hookCandidates: string[]
  reusableLines: string[]
  brokenFragments: string[]
  unusableFragments: string[]
}

type PreservationPolicy = {
  sourceReuseTarget?: number
  maxInventedLinesPerSection?: number
  allowedConnectiveLinesPerVersion?: number
  preferredStructures?: Record<string, string[]>
}

type PipelineResult = {
  output: JsonObject | null
  attemptCount: number
  schemaValid: boolean
  qualityScore: number
  finalDecision: string
  error?: string
}

const EXTRACTION_SCHEMA = {
  type: 'object',
  required: ['signaturePhrases', 'slangTokens', 'emotionalTone', 'hookCandidates', 'reusableLines', 'brokenFragments', 'unusableFragments'],
  properties: {
    signaturePhrases: stringArraySchema(),
    slangTokens: stringArraySchema(),
    emotionalTone: { type: 'string' },
    hookCandidates: stringArraySchema(),
    reusableLines: stringArraySchema(),
    brokenFragments: stringArraySchema(),
    unusableFragments: stringArraySchema(),
  },
} as const

export async function executeFreestyleWriterPipeline(input: {
  transcript: string
  instructions?: Record<string, unknown>
  schema?: JsonObject
  temperature: number
  maxAttempts: number
  model: string
  generateWithOllama: (input: { task: string; schema?: JsonObject; temperature: number }) => Promise<string>
  preservationPolicy?: PreservationPolicy
  artistMemory?: Record<string, unknown>
}): Promise<PipelineResult> {
  const transcript = input.transcript.trim()
  const deterministic = extractTranscriptMaterial(transcript)
  const extraction = await extractWithModel({
    transcript,
    deterministic,
    temperature: Math.min(0.35, input.temperature),
    generateWithOllama: input.generateWithOllama,
  })
  const merged = mergeExtraction(deterministic, extraction)
  let lastError = 'Freestyle Writer generation failed'

  for (let attempt = 1; attempt <= input.maxAttempts; attempt += 1) {
    const task = buildGenerationTask({
      transcript,
      extraction: merged,
      instructions: input.instructions ?? {},
      schema: input.schema,
      policy: input.preservationPolicy,
      artistMemory: input.artistMemory,
      previousError: attempt === 1 ? null : lastError,
    })

    try {
      const rawContent = await input.generateWithOllama({
        task,
        schema: input.schema,
        temperature: Math.min(0.5, input.temperature),
      })

      const parsed = parseJsonResponse(rawContent)
      normalizeFreestyleArrangement(parsed, merged)
      normalizeFreestyleCategory(parsed, transcript)
      hydrateVersionScores(parsed, transcript, merged, input.preservationPolicy)

      const schemaValidation = validateAgainstSchema(parsed, input.schema)
      let quality = evaluateFreestyleQuality(parsed, transcript, merged, input.preservationPolicy)

      if (!quality.valid && canRecoverWithDeterministicArrangement(quality.errors)) {
        normalizeFreestyleArrangement(parsed, merged, { forceReplaceAll: true })
        hydrateVersionScores(parsed, transcript, merged, input.preservationPolicy)
        quality = evaluateFreestyleQuality(parsed, transcript, merged, input.preservationPolicy)
      }

      if (schemaValidation.valid && quality.valid) {
        return {
          output: parsed,
          attemptCount: attempt,
          schemaValid: true,
          qualityScore: quality.score,
          finalDecision: 'accepted',
        }
      }

      lastError = [...schemaValidation.errors, ...quality.errors].join('; ')
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  return {
    output: null,
    attemptCount: input.maxAttempts,
    schemaValid: false,
    qualityScore: 0,
    finalDecision: 'rejected',
    error: lastError,
  }
}

function extractTranscriptMaterial(transcript: string): ExtractionResult {
  const rawLines = transcript
    .split(/\r?\n|[.!?](?:\s+|$)|,\s+/)
    .map((line) => line.trim())
    .filter(Boolean)
  const clauseLines = rawLines.flatMap((line) => splitSourceClauses(line))
  const sourceCandidates = fuzzyUnique([...rawLines, ...clauseLines])

  const reusableLines = sourceCandidates
    .filter((line) => countWords(line) >= 4 && countWords(line) <= 10)
    .sort((left, right) => scoreArrangementLine(right) - scoreArrangementLine(left))
    .slice(0, 18)
  const signaturePhrases = sourceCandidates
    .filter((phrase) => countWords(phrase) >= 3 && countWords(phrase) <= 8)
    .sort((left, right) => scoreArrangementLine(right) - scoreArrangementLine(left))
    .slice(0, 24)

  const slangTokens = unique(
    (transcript.toLowerCase().match(/[a-z0-9']+/g) ?? []).filter(isRecognizedSlangToken),
  ).slice(0, 16)

  const hookCandidates = sourceCandidates
    .filter((line) => /pain|love|night|pressure|dream|money|heart|grind|ride|motion|shadow|fire|cold|legacy|name|city/i.test(line))
    .sort((left, right) => scoreArrangementLine(right) - scoreArrangementLine(left))
    .slice(0, 12)

  const brokenFragments = fuzzyUnique(sourceCandidates.filter((line) => countWords(line) >= 2 && countWords(line) <= 3)).slice(0, 10)
  const unusableFragments = fuzzyUnique(sourceCandidates.filter((line) => countWords(line) < 2 || line.length < 6)).slice(0, 8)

  return {
    signaturePhrases,
    slangTokens,
    emotionalTone: inferTone(transcript),
    hookCandidates,
    reusableLines,
    brokenFragments,
    unusableFragments,
  }
}

async function extractWithModel(input: {
  transcript: string
  deterministic: ExtractionResult
  temperature: number
  generateWithOllama: (input: { task: string; schema?: JsonObject; temperature: number }) => Promise<string>
}) {
  const task = [
    'You are extracting preserved artist material for a source-first lyric reconstruction pipeline.',
    'Do not write lyrics.',
    'Only return structured extraction JSON.',
    '',
    `Transcript:\n${input.transcript}`,
    '',
    `Deterministic seed extraction:\n${JSON.stringify(input.deterministic, null, 2)}`,
    '',
    'Rules:',
    '- prefer exact source phrases over paraphrase',
    '- keep slang tokens exactly as spoken',
    '- hook candidates must come from source material',
    '- put badly broken fragments in brokenFragments or unusableFragments instead of forcing reuse',
  ].join('\n')

  try {
    const raw = await input.generateWithOllama({
      task,
      schema: EXTRACTION_SCHEMA as unknown as JsonObject,
      temperature: input.temperature,
    })
    const parsed = parseJsonResponse(raw)
    const validation = validateAgainstSchema(parsed, EXTRACTION_SCHEMA as unknown as JsonObject)
    if (!validation.valid) {
      return input.deterministic
    }
    return parsed as ExtractionResult
  } catch {
    return input.deterministic
  }
}

function mergeExtraction(deterministic: ExtractionResult, model: ExtractionResult): ExtractionResult {
  return {
    signaturePhrases: fuzzyUnique([...deterministic.signaturePhrases, ...safeArray(model.signaturePhrases)]).slice(0, 24),
    slangTokens: unique([...deterministic.slangTokens, ...safeArray(model.slangTokens)]).slice(0, 18),
    emotionalTone: model.emotionalTone || deterministic.emotionalTone,
    hookCandidates: fuzzyUnique([...deterministic.hookCandidates, ...safeArray(model.hookCandidates)]).slice(0, 12),
    reusableLines: fuzzyUnique([...deterministic.reusableLines, ...safeArray(model.reusableLines)]).slice(0, 18),
    brokenFragments: fuzzyUnique([...deterministic.brokenFragments, ...safeArray(model.brokenFragments)]).slice(0, 10),
    unusableFragments: fuzzyUnique([...deterministic.unusableFragments, ...safeArray(model.unusableFragments)]).slice(0, 8),
  }
}

function buildGenerationTask(input: {
  transcript: string
  extraction: ExtractionResult
  instructions: Record<string, unknown>
  schema?: JsonObject
  policy?: PreservationPolicy
  artistMemory?: Record<string, unknown>
  previousError: string | null
}) {
  const structures = input.policy?.preferredStructures ?? {
    melodic: ['Hook', 'Verse', 'Hook', 'Outro'],
    fast: ['Verse', 'Hook', 'Verse'],
    hybrid: ['Hook', 'Verse', 'Hook', 'Verse'],
    remix: ['Verse', 'Hook', 'Verse', 'Outro'],
  }
  const sourceRichness = buildSourceArrangementLines(input.extraction).length
  const richnessRule =
    sourceRichness >= 4 || countWords(input.transcript) >= 18
      ? 'Source is rich enough for fuller drafts: each version must use 4 to 5 distinct source-backed lines before collapsing.'
      : 'If source material is genuinely thin, 3 compact lines is acceptable; otherwise prefer 4 lines.'

  return [
    'You are reconstructing unfinished artist material into usable songs.',
    'This is not generic lyric writing.',
    'Source-first policy: reorder and reuse before inventing.',
    '',
    `Original transcript:\n${input.transcript}`,
    '',
    `Locked extraction material:\n${JSON.stringify(input.extraction, null, 2)}`,
    '',
    input.artistMemory ? `Artist memory:\n${JSON.stringify(input.artistMemory, null, 2)}` : null,
    `Generation policy:\n${JSON.stringify({
      sourceReuseTarget: input.policy?.sourceReuseTarget ?? 0.76,
      maxInventedLinesPerSection: input.policy?.maxInventedLinesPerSection ?? 1,
      allowedConnectiveLinesPerVersion: input.policy?.allowedConnectiveLinesPerVersion ?? 2,
      structures,
    }, null, 2)}`,
    '',
    'Hard rules:',
    '- reuse original lines or near-source phrases first',
    '- hook must be built from hookCandidates or signaturePhrases',
    '- keep slang tokens exactly if they appear in the source',
    '- do not invent backstory, new characters, or generic motivational filler',
    '- each version should stay compact and section-simple',
    '- every version must be written as readable short lines, not a paragraph',
    '- rich transcripts should expand into 4 to 5 distinct lines, not collapse into a tight loop',
    '- use line breaks so sections are readable',
    '- each version must feel like a usable draft record structure, not notes',
    '- versions must not be near-duplicates of each other',
    '- do not repeat the same line body across sections unless it is a hook return, and even then only once',
    '- do not use generic filler like "oh yeah", "ready for the ride", "new perspective", "lease on life", "flowy", or empty ad-libs',
    '- if source material is thin, keep the version shorter rather than inventing',
    `- ${richnessRule}`,
    '',
    `Style wrappers:\n${JSON.stringify(input.instructions, null, 2)}`,
    input.schema ? `JSON schema:\n${JSON.stringify(input.schema, null, 2)}` : null,
    input.previousError ? `Previous rejection reason:\n${input.previousError}` : null,
    'Return one JSON object only.',
  ]
    .filter(Boolean)
    .join('\n\n')
}

function evaluateFreestyleQuality(
  output: unknown,
  transcript: string,
  extraction: ExtractionResult,
  policy?: PreservationPolicy,
) {
  const lyricBodies = extractLyrics(output)
  if (lyricBodies.length === 0) {
    return {
      valid: false,
      score: 0,
      errors: ['Generated output did not contain any lyric bodies to score for preservation'],
    }
  }

  const sourceTerms = tokenizeDistinctiveTerms(transcript)
  const phrasePool = buildCorePhrasePool(extraction)
  const slangPool = extractTranscriptSlangTokens(transcript)
  const hookPool = phrasePool.slice(0, 2)
  const sourceReuseTarget = policy?.sourceReuseTarget ?? 0.76
  const maxConnectiveLines = policy?.allowedConnectiveLinesPerVersion ?? 2
  const sourceArrangementLines = buildSourceArrangementLines(extraction)
  const sourceRichness = sourceArrangementLines.length
  const transcriptWordCount = Math.max(countWords(transcript), 1)
  const targetWordsPerVersion = deriveTargetWordsPerVersion(transcriptWordCount, sourceRichness)
  const targetUniqueLinesPerVersion = deriveTargetUniqueLinesPerVersion(sourceRichness, transcriptWordCount)
  const averageLineCount = avg(lyricBodies.map((lyrics) => normalizeLyricLines(lyrics).length))
  const hookReuseRate = hookPool.length === 0
    ? 1
    : avg(lyricBodies.map((lyrics) => countPhraseMatches(lyrics, hookPool) > 0 ? 1 : 0))
  const pairwiseSimilarity = computeAveragePairwiseSimilarity(lyricBodies)
  const fillerPenalty = countGenericFillerHits(lyricBodies)

  const perVersion = lyricBodies.map((lyrics) => {
    const lines = normalizeLyricLines(lyrics)
    const comparableLines = comparableLineSequence(lyrics)
    const uniqueComparableLines = new Set(comparableLines)
    const phraseRetention = phrasePool.length === 0 ? 1 : countPhraseMatches(lyrics, phrasePool) / phrasePool.length
    const termRetention = computeTermOverlap(sourceTerms, lyrics)
    const slangRetention =
      slangPool.length === 0
        ? 1
        : slangPool.filter((token) => lyrics.toLowerCase().includes(token.toLowerCase())).length / slangPool.length
    const connectiveLines = lines.filter((line) => !isNearSourceLine(line, extraction)).length
    const wordCount = countWords(stripSectionLabels(lyrics))
    const compressionResistance = Math.min(1, wordCount / targetWordsPerVersion)
    const structuralRichness = Math.min(1, uniqueComparableLines.size / targetUniqueLinesPerVersion)
    const repeatedLineRatio = computeVersionRepetitionRatio(lyrics, hookPool)
    return {
      phraseRetention,
      termRetention,
      slangRetention,
      connectiveLines,
      compressionResistance,
      structuralRichness,
      repeatedLineRatio,
    }
  })

  const averagePhraseRetention = avg(perVersion.map((item) => item.phraseRetention))
  const minimumTermRetention = Math.min(...perVersion.map((item) => item.termRetention))
  const averageSlangRetention = avg(perVersion.map((item) => item.slangRetention))
  const maxConnectiveUsed = Math.max(...perVersion.map((item) => item.connectiveLines))
  const averageCompressionResistance = avg(perVersion.map((item) => item.compressionResistance))
  const averageStructuralRichness = avg(perVersion.map((item) => item.structuralRichness))
  const maxRepeatedLineRatio = Math.max(...perVersion.map((item) => item.repeatedLineRatio))
  const baseScore =
    averagePhraseRetention * 38 +
    minimumTermRetention * 24 +
    averageSlangRetention * 14 +
    Math.max(0, 8 - maxConnectiveUsed * 2) +
    Math.min(8, averageLineCount * 2) +
    hookReuseRate * 5 +
    averageCompressionResistance * 6 +
    averageStructuralRichness * 6 +
    Math.max(0, 4 - maxRepeatedLineRatio * 24) +
    Math.max(0, 10 - pairwiseSimilarity * 10) -
    fillerPenalty * 3
  const guardrailCap = Math.min(
    averagePhraseRetention * 100 + 18,
    minimumTermRetention * 100 + 20,
    averageCompressionResistance * 100 + 6,
    averageStructuralRichness * 100 + 6,
    (1 - maxRepeatedLineRatio) * 100,
    (1 - pairwiseSimilarity) * 100 + 24,
  )
  const score = Math.round(Math.min(99, baseScore, guardrailCap))
  const errors: string[] = []

  if (averagePhraseRetention < sourceReuseTarget) {
    errors.push(
      `Source reuse target missed: average source phrase retention was ${(averagePhraseRetention * 100).toFixed(1)}%`,
    )
  }

  if (minimumTermRetention < 0.24) {
    errors.push(`Distinctive-term retention too low: weakest version retained ${(minimumTermRetention * 100).toFixed(1)}%`)
  }

  if (slangPool.length > 0 && averageSlangRetention < 0.7) {
    errors.push(
      `Slang retention too low: average slang retention was ${(averageSlangRetention * 100).toFixed(1)}% (pool: ${slangPool.join(', ')})`,
    )
  }

  if (maxConnectiveUsed > maxConnectiveLines) {
    errors.push(`Too many invented connective lines: max ${maxConnectiveLines}, saw ${maxConnectiveUsed}`)
  }

  if (averageLineCount < 3) {
    errors.push(`Arrangement too thin: average version only produced ${averageLineCount.toFixed(1)} lines`)
  }

  if ((sourceRichness >= 4 || transcriptWordCount >= 18) && averageCompressionResistance < 0.88) {
    errors.push(
      `Compression too high: average version only hit ${(averageCompressionResistance * 100).toFixed(1)}% of the minimum word target`,
    )
  }

  if ((sourceRichness >= 4 || transcriptWordCount >= 18) && averageStructuralRichness < 0.92) {
    errors.push(
      `Structural richness too low: average version only delivered ${(averageStructuralRichness * 100).toFixed(1)}% of the unique-line target`,
    )
  }

  if (hookPool.length > 0 && hookReuseRate < 0.5) {
    errors.push(
      `Hook reuse too weak: only ${(hookReuseRate * 100).toFixed(1)}% of versions reused a source hook candidate (pool: ${hookPool.join(' | ')})`,
    )
  }

  if (maxRepeatedLineRatio > 0.18) {
    errors.push(
      `Section repetition too high: worst version repeated ${(maxRepeatedLineRatio * 100).toFixed(1)}% of its line bodies`,
    )
  }

  if (pairwiseSimilarity > 0.92) {
    errors.push(`Versions too similar: average cross-version similarity was ${(pairwiseSimilarity * 100).toFixed(1)}%`)
  }

  if (fillerPenalty > 1) {
    errors.push(`Generic filler detected too often: ${fillerPenalty} filler-pattern hits`)
  }

  return {
    valid: errors.length === 0,
    score,
    errors,
  }
}

function hydrateVersionScores(
  output: JsonObject,
  transcript: string,
  extraction: ExtractionResult,
  policy?: PreservationPolicy,
) {
  const transcriptTerms = tokenizeDistinctiveTerms(transcript)
  const phrasePool = buildCorePhrasePool(extraction)
  const slangPool = extractTranscriptSlangTokens(transcript)
  const hookPool = phrasePool.slice(0, 2)
  const sourceArrangementLines = buildSourceArrangementLines(extraction)
  const sourceRichness = sourceArrangementLines.length
  const transcriptWordCount = Math.max(countWords(transcript), 1)
  const targetWordsPerVersion = deriveTargetWordsPerVersion(transcriptWordCount, sourceRichness)
  const targetUniqueLinesPerVersion = deriveTargetUniqueLinesPerVersion(sourceRichness, transcriptWordCount)
  const maxConnectiveLines = policy?.allowedConnectiveLinesPerVersion ?? 2

  for (const key of ['melodic', 'fast', 'hybrid', 'remix']) {
    const candidate = output[key]
    if (candidate && typeof candidate === 'object' && typeof candidate.lyrics === 'string') {
      const lines = normalizeLyricLines(candidate.lyrics)
      const comparableLines = new Set(comparableLineSequence(candidate.lyrics))
      const termRetention = computeTermOverlap(transcriptTerms, candidate.lyrics)
      const phraseRetention =
        phrasePool.length === 0 ? 1 : countPhraseMatches(candidate.lyrics, phrasePool) / phrasePool.length
      const slangRetention =
        slangPool.length === 0
          ? 1
          : slangPool.filter((token) => candidate.lyrics.toLowerCase().includes(token.toLowerCase())).length / slangPool.length
      const connectiveLines = lines.filter((line) => !isNearSourceLine(line, extraction)).length
      const compressionResistance = Math.min(1, countWords(stripSectionLabels(candidate.lyrics)) / targetWordsPerVersion)
      const structuralRichness = Math.min(1, comparableLines.size / targetUniqueLinesPerVersion)
      const repeatedLineRatio = computeVersionRepetitionRatio(candidate.lyrics, hookPool)
      const hookReuse = hookPool.length === 0 ? 1 : countPhraseMatches(candidate.lyrics, hookPool) > 0 ? 1 : 0
      const lineDiscipline =
        lines.length >= 3 && lines.length <= 5 ? 1 : lines.length === 2 || lines.length === 6 ? 0.72 : 0.45
      const connectiveDiscipline = Math.max(0, 1 - Math.max(0, connectiveLines - maxConnectiveLines) * 0.35)
      const repetitionResistance = Math.max(0, 1 - repeatedLineRatio)

      const baseScore =
        termRetention * 28 +
        phraseRetention * 20 +
        slangRetention * 10 +
        compressionResistance * 12 +
        structuralRichness * 12 +
        lineDiscipline * 8 +
        hookReuse * 5 +
        repetitionResistance * 5 +
        connectiveDiscipline * 5
      const guardrailCap = Math.min(
        termRetention * 100 + 18,
        phraseRetention * 100 + 14,
        compressionResistance * 100 + 8,
        structuralRichness * 100 + 6,
        repetitionResistance * 100,
        lineDiscipline * 100 + 8,
      )

      candidate.score = Math.max(1, Math.min(96, Math.round(Math.min(baseScore, guardrailCap))))
    }
  }
}

function normalizeFreestyleArrangement(
  output: JsonObject,
  extraction: ExtractionResult,
  options?: { forceReplaceAll?: boolean },
) {
  const sourceLines = buildSourceArrangementLines(extraction)
  if (sourceLines.length === 0) {
    return
  }

  const variants: Record<string, string[]> = {
    melodic: buildVariantLines('melodic', sourceLines),
    fast: buildVariantLines('fast', sourceLines),
    hybrid: buildVariantLines('hybrid', sourceLines),
    remix: buildVariantLines('remix', sourceLines),
  }

  for (const key of ['melodic', 'fast', 'hybrid', 'remix']) {
    const candidate = output[key]
    if (!candidate || typeof candidate !== 'object' || typeof candidate.lyrics !== 'string') {
      continue
    }

    const normalizedExisting = normalizeLyricLines(candidate.lyrics)
      .map((line) => sanitizeLine(line))
      .filter(Boolean)
    const existingSimilarity = similarity(
      normalizedExisting.join(' ').toLowerCase(),
      variants[key].join(' ').toLowerCase(),
    )
    const shouldReplace =
      options?.forceReplaceAll ||
      normalizedExisting.length < (sourceLines.length >= 4 ? 4 : 3) ||
      normalizedExisting.length > 5 ||
      computeVersionRepetitionRatio(candidate.lyrics, extraction.hookCandidates) > 0.18 ||
      computeStructuralRichness(candidate.lyrics, sourceLines.length, 18) < (sourceLines.length >= 4 ? 0.92 : 0.75) ||
      existingSimilarity > 0.92 ||
      countGenericFillerHits([candidate.lyrics]) > 0

    if (shouldReplace) {
      candidate.lyrics = variants[key].join('\n')
    }
  }
}

function extractLyrics(output: unknown) {
  if (!output || typeof output !== 'object') {
    return []
  }

  return Object.values(output as Record<string, unknown>)
    .map((value) => {
      if (value && typeof value === 'object' && typeof (value as Record<string, unknown>).lyrics === 'string') {
        return String((value as Record<string, unknown>).lyrics)
      }
      return null
    })
    .filter((value): value is string => Boolean(value))
}

function normalizeLyricLines(lyrics: string) {
  return lyrics
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function isNearSourceLine(line: string, extraction: ExtractionResult) {
  const comparable = stripSectionLabels(line).toLowerCase()
  const sourcePool = buildSourceArrangementLines(extraction)
  return sourcePool.some((source) => similarity(source.toLowerCase(), comparable) >= 0.58 || comparable.includes(source.toLowerCase()))
}

function similarity(left: string, right: string) {
  const leftTokens = new Set(left.match(/[a-z0-9']+/g) ?? [])
  const rightTokens = new Set(right.match(/[a-z0-9']+/g) ?? [])
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0
  }
  const overlap = Array.from(leftTokens).filter((token) => rightTokens.has(token)).length
  return overlap / Math.max(leftTokens.size, rightTokens.size)
}

function computeAveragePairwiseSimilarity(versions: string[]) {
  if (versions.length < 2) {
    return 0
  }

  const scores: number[] = []
  for (let i = 0; i < versions.length; i += 1) {
    for (let j = i + 1; j < versions.length; j += 1) {
      scores.push(sequenceSimilarity(versions[i], versions[j]))
    }
  }

  return avg(scores)
}

function sequenceSimilarity(left: string, right: string) {
  const leftLines = comparableLineSet(left)
  const rightLines = comparableLineSet(right)
  if (leftLines.size === 0 || rightLines.size === 0) {
    return similarity(stripSectionLabels(left).toLowerCase(), stripSectionLabels(right).toLowerCase())
  }

  const lineOverlap = Array.from(leftLines).filter((token) => rightLines.has(token)).length / Math.max(leftLines.size, rightLines.size)
  const leftSequence = comparableLineSequence(left)
  const rightSequence = comparableLineSequence(right)
  const leftBigrams = buildLineBigrams(leftSequence)
  const rightBigrams = buildLineBigrams(rightSequence)
  const sequenceOverlap =
    leftBigrams.size === 0 || rightBigrams.size === 0
      ? 0
      : Array.from(leftBigrams).filter((token) => rightBigrams.has(token)).length / Math.max(leftBigrams.size, rightBigrams.size)

  return lineOverlap * 0.45 + sequenceOverlap * 0.55
}

function countGenericFillerHits(versions: string[]) {
  const fillerPatterns = [
    /oh yeah/gi,
    /ready for the ride/gi,
    /new perspective/gi,
    /lease on life/gi,
    /flowy/gi,
    /unexpected harmony/gi,
    /oh+$/gim,
    /\byeah+\b/gi,
  ]

  return versions.reduce((count, lyrics) => {
    return (
      count +
      fillerPatterns.reduce((inner, pattern) => inner + (lyrics.match(pattern)?.length ?? 0), 0)
    )
  }, 0)
}

function countPhraseMatches(text: string, phrases: string[]) {
  const lower = text.toLowerCase()
  return phrases.filter((phrase) => lower.includes(phrase.toLowerCase())).length
}

function buildSourceArrangementLines(extraction: ExtractionResult) {
  const exactLines = fuzzyUnique([
    ...extraction.hookCandidates,
    ...extraction.reusableLines,
    ...extraction.signaturePhrases,
  ])
    .flatMap((line) => {
      const sanitized = sanitizeLine(line)
      const clauses = splitSourceClauses(sanitized)
      return fuzzyUnique([
        sanitized,
        ...clauses,
        ...clauses.flatMap((clause) => expandArrangementFragments(clause)),
      ])
    })
    .filter((line) => countWords(line) >= 4)

  return fuzzyUnique(exactLines)
    .sort((left, right) => scoreArrangementLine(right) - scoreArrangementLine(left))
    .slice(0, 12)
}

function buildCorePhrasePool(extraction: ExtractionResult) {
  return buildSourceArrangementLines(extraction)
    .map((phrase) => sanitizeLine(phrase))
    .filter((phrase) => {
      const words = countWords(phrase)
      return words >= 3 && words <= 8
    })
    .slice(0, 4)
}

function buildVariantLines(
  style: 'melodic' | 'fast' | 'hybrid' | 'remix',
  sourceLines: string[],
) {
  const primaryHook = pickSourceLine(sourceLines, /pain|motion|pressure|pay off|money|love|heart|shadow|dream|legacy/i) ?? sourceLines[0]
  const confession = pickSourceLine(sourceLines, /chest|heart|shadow|name|hurt|scar|back|rent|silence/i, [primaryHook]) ?? sourceLines[1] ?? primaryHook
  const pressure = pickSourceLine(sourceLines, /pressure|break|broke|cold|storm|weight|burden|grind/i, [primaryHook, confession]) ?? sourceLines[2] ?? confession
  const intro = pickSourceLine(sourceLines, /\bi\b|my|me|all night|no sleep|used to|been/i, [primaryHook, confession, pressure]) ?? sourceLines[3] ?? pressure
  const tail = pickSourceLine(sourceLines, /pay off|breaks me|future|owed|warning|lesson|fire|motion/i, [primaryHook, confession, pressure, intro]) ?? sourceLines[4] ?? pressure
  const alt = pickSourceLine(sourceLines, /thoughts|voice|melodies|city|sauce|purpose|legacy|fit|whip|chain|flash|focused/i, [primaryHook, confession, pressure, intro, tail]) ?? sourceLines[5] ?? confession
  const detail = pickSourceLine(sourceLines, /fit|whip|city|chain|flash|eyes|room|smoke|name|focused/i, [primaryHook, confession, pressure, intro, tail, alt]) ?? sourceLines[6] ?? alt
  const fullLine = pickOpenSourceLine(
    sourceLines.filter((line) => countWords(line) >= 6),
    [primaryHook, confession, pressure, intro, tail, alt, detail],
  ) ?? pickOpenSourceLine(sourceLines, [primaryHook, confession, pressure, intro, tail, alt, detail]) ?? detail
  const fastHook = pickSourceLine(
    sourceLines,
    /focused|city|fit|whip|warning|lesson|legacy|breaks me|all night|motion/i,
    [primaryHook, confession, tail],
  ) ?? pressure
  const hybridHook = blendSourceFragments(primaryHook, alt) ?? primaryHook
  const remixHook = pickSourceLine(
    sourceLines,
    /focused|all night|city|thoughts|legacy|breaks me|whip|fit|name/i,
    [primaryHook, confession, pressure],
  ) ?? alt

  const variants: Record<typeof style, string[]> = {
    melodic: dedupeVariantLines(
      [
        `Hook: ${primaryHook}`,
        `Float: ${blendSourceFragments(confession, intro) ?? confession}`,
        `Lift: ${tail}`,
        `Outro: ${detail}`,
      ],
      sourceLines,
    ),
    fast: dedupeVariantLines(
      [
        `Punch-In: ${pressure}`,
        `Run-Up: ${detail}`,
        `Drive: ${blendSourceFragments(alt, tail) ?? alt}`,
        `Hook Snap: ${fastHook}`,
        `Close: ${intro}`,
      ],
      sourceLines,
    ),
    hybrid: dedupeVariantLines(
      [
        `Hook Lead: ${hybridHook}`,
        `Verse One: ${fullLine}`,
        `Pivot: ${blendSourceFragments(confession, tail) ?? confession}`,
        `Return: ${intro}`,
      ],
      sourceLines,
    ),
    remix: dedupeVariantLines(
      [
        `Flip: ${alt}`,
        `Hook Twist: ${remixHook}`,
        `Switch-Up: ${pressure}`,
        `Outro: ${fullLine}`,
      ],
      sourceLines,
    ),
  }

  return variants[style].map((line) => sanitizeLine(line)).filter(Boolean).slice(0, 5)
}

function sanitizeLine(line: string) {
  return line
    .replace(/^locked extraction material:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function splitSourceClauses(line: string) {
  return fuzzyUnique(
    line
      .split(/\s*,\s*|\s+and\s+|\s+but\s+|\s+before\s+|\s+trying to\s+|\s+with\s+/i)
      .map((clause) => clause.trim())
      .filter(Boolean),
  )
}

function expandArrangementFragments(line: string) {
  const words = line.split(/\s+/).filter(Boolean)
  if (words.length <= 6) {
    return isUsableFragment(line) ? [line] : []
  }

  const first = words.slice(0, Math.min(5, words.length)).join(' ')
  const last = words.slice(Math.max(0, words.length - 5)).join(' ')
  const bestFragment = [first, last]
    .filter((fragment) => isUsableFragment(fragment))
    .sort((left, right) => scoreArrangementLine(right) - scoreArrangementLine(left))[0]

  return fuzzyUnique([line, bestFragment].filter(Boolean))
}

function canRecoverWithDeterministicArrangement(errors: string[]) {
  return errors.some((error) =>
    /Too many invented connective lines|Arrangement too thin|Versions too similar|Hook reuse too weak|Compression too high|Structural richness too low|Section repetition too high/i.test(error),
  )
}

function isUsableFragment(line: string) {
  const words = line.split(/\s+/).filter(Boolean)
  const firstWord = words[0]?.toLowerCase() ?? ''
  const lastWord = words.at(-1)?.toLowerCase() ?? ''
  if (words.length < 4) {
    return false
  }

  return (
    !/^(to|into|with|and|but|before|trying)$/i.test(firstWord) &&
    !/^(to|into|with|and|but|before|trying|make|turn)$/i.test(lastWord)
  )
}

function scoreArrangementLine(line: string) {
  const wordCount = countWords(line)
  const anchorBoost = /pain|motion|pressure|pay off|heart|dream|money|love|shadow|legacy|sauce/i.test(line) ? 4 : 0
  const contextBoost = /night|grind|broke|chest|city|future/i.test(line) ? 1 : 0
  const compactBoost = wordCount >= 3 && wordCount <= 6 ? 2 : wordCount <= 9 ? 1 : 0
  const firstPersonBoost = /\b(i|my|me)\b/i.test(line) ? 1 : 0
  const endingPenalty = isUsableFragment(line) ? 0 : 3
  return anchorBoost + contextBoost + compactBoost + firstPersonBoost - endingPenalty
}

function pickSourceLine(sourceLines: string[], pattern: RegExp, exclude: string[] = []) {
  const excluded = exclude.filter(Boolean)
  return sourceLines.find(
    (line) =>
      !excluded.some((blocked) => similarity(blocked.toLowerCase(), line.toLowerCase()) >= 0.82) &&
      pattern.test(line),
  )
}

function pickOpenSourceLine(sourceLines: string[], exclude: string[] = []) {
  const excluded = exclude.filter(Boolean)
  return sourceLines.find(
    (line) => !excluded.some((blocked) => similarity(blocked.toLowerCase(), line.toLowerCase()) >= 0.82),
  )
}

function blendSourceFragments(primary?: string, secondary?: string) {
  if (!primary) {
    return secondary ?? null
  }
  if (!secondary) {
    return primary
  }

  const left = stripSectionLabels(primary).trim()
  const right = stripSectionLabels(secondary).trim()
  if (!left || !right) {
    return left || right || null
  }
  if (similarity(left.toLowerCase(), right.toLowerCase()) >= 0.7) {
    return left
  }

  const stitched = `${left}, ${right}`
  if (countWords(stitched) > 10) {
    return scoreArrangementLine(left) >= scoreArrangementLine(right) ? left : right
  }

  return stitched
}

function dedupeVariantLines(lines: string[], sourceLines: string[]) {
  const seenBodies: string[] = []
  const deduped: string[] = []

  for (const line of lines) {
    const body = stripSectionLabels(line).toLowerCase()
    if (!body || seenBodies.some((seen) => similarity(seen, body) >= 0.82)) {
      continue
    }
    seenBodies.push(body)
    deduped.push(line)
  }

  const fillerLabels = ['Bridge', 'Lift', 'Tail', 'Echo', 'Resolve']
  for (const sourceLine of sourceLines) {
    if (deduped.length >= 5) {
      break
    }
    const body = sourceLine.toLowerCase()
    if (seenBodies.some((seen) => similarity(seen, body) >= 0.82)) {
      continue
    }
    seenBodies.push(body)
    deduped.push(`${fillerLabels[deduped.length - 1] ?? 'Extra'}: ${sourceLine}`)
  }

  return deduped
}

function fuzzyUnique(values: string[], threshold = 0.82) {
  const deduped: string[] = []

  for (const rawValue of values) {
    const value = rawValue.trim()
    if (!value) {
      continue
    }
    const comparable = stripSectionLabels(value).toLowerCase()
    if (!comparable) {
      continue
    }
    if (deduped.some((existing) => similarity(stripSectionLabels(existing).toLowerCase(), comparable) >= threshold)) {
      continue
    }
    deduped.push(value)
  }

  return deduped
}

function normalizeFreestyleCategory(output: JsonObject, transcript: string) {
  if (!output || typeof output !== 'object') {
    return
  }

  output.category = inferCategory(transcript)
}

function inferCategory(transcript: string) {
  if (/girl|love|heart|miss|shadow|eyes|fire|toxic/i.test(transcript)) return 'love'
  if (/money|chain|whip|fit|flash|sauce|designer|city/i.test(transcript)) return 'flex'
  if (/grind|dream|legacy|work|build|future|owed|prove/i.test(transcript)) return 'grind'
  if (/switch|scar|smoke|hate|room|slick|warning|circle/i.test(transcript)) return 'street'
  return 'pain'
}

function comparableLineSet(lyrics: string) {
  return new Set(comparableLineSequence(lyrics))
}

function stripSectionLabels(line: string) {
  return line.replace(/^[a-z][a-z0-9 -]{0,24}:\s*/i, '').trim()
}

function comparableLineSequence(lyrics: string) {
  return normalizeLyricLines(lyrics)
    .map((line) => stripSectionLabels(line).toLowerCase())
    .filter(Boolean)
}

function deriveTargetWordsPerVersion(transcriptWordCount: number, sourceRichness: number) {
  if (transcriptWordCount >= 30 || sourceRichness >= 8) return 18
  if (transcriptWordCount >= 18 || sourceRichness >= 4) return 16
  return 12
}

function deriveTargetUniqueLinesPerVersion(sourceRichness: number, transcriptWordCount: number) {
  if (transcriptWordCount >= 30 || sourceRichness >= 8) return 5
  if (transcriptWordCount >= 18 || sourceRichness >= 4) return 4
  return 3
}

function computeStructuralRichness(lyrics: string, sourceRichness: number, transcriptWordCount = 0) {
  const targetUniqueLines = deriveTargetUniqueLinesPerVersion(sourceRichness, transcriptWordCount)
  const uniqueComparableLines = new Set(comparableLineSequence(lyrics))
  return Math.min(1, uniqueComparableLines.size / targetUniqueLines)
}

function computeVersionRepetitionRatio(lyrics: string, hookPool: string[]) {
  const lines = normalizeLyricLines(lyrics)
  if (lines.length === 0) {
    return 0
  }

  const repeatedBodies: Array<{ body: string; count: number; hookAnchored: boolean }> = []
  for (const line of lines) {
    const body = stripSectionLabels(line).toLowerCase()
    if (!body) {
      continue
    }
    const existing = repeatedBodies.find((entry) => similarity(entry.body, body) >= 0.82)
    if (existing) {
      existing.count += 1
      existing.hookAnchored = existing.hookAnchored || hookPool.some((phrase) => body.includes(phrase.toLowerCase()))
      continue
    }
    repeatedBodies.push({
      body,
      count: 1,
      hookAnchored: hookPool.some((phrase) => body.includes(phrase.toLowerCase())),
    })
  }

  let repeatedUnits = 0
  for (const entry of repeatedBodies) {
    const allowance = entry.hookAnchored ? 1 : 0
    repeatedUnits += Math.max(0, entry.count - 1 - allowance)
  }

  return repeatedUnits / lines.length
}

function buildLineBigrams(lines: string[]) {
  const bigrams = new Set<string>()
  for (let index = 0; index < lines.length - 1; index += 1) {
    bigrams.add(`${lines[index]} >>> ${lines[index + 1]}`)
  }
  return bigrams
}

function tokenizeDistinctiveTerms(text: string) {
  const stopwords = new Set([
    'about', 'after', 'again', 'aint', 'been', 'before', 'being', 'but', 'came', 'cant', 'could', 'dont', 'each',
    'from', 'have', 'into', 'just', 'made', 'make', 'more', 'must', 'only', 'over', 'same', 'should', 'some', 'than',
    'that', 'them', 'then', 'they', 'this', 'through', 'trying', 'turn', 'with', 'your', 'youre', 'where', 'while',
  ])

  return Array.from(
    new Set(
      text
        .toLowerCase()
        .match(/[a-z0-9']+/g)?.filter((token) => token.length >= 4 && !stopwords.has(token)) ?? [],
    ),
  )
}

function extractTranscriptSlangTokens(text: string) {
  return unique(
    (text.toLowerCase().match(/[a-z0-9']+/g) ?? []).filter(isRecognizedSlangToken),
  )
}

function isRecognizedSlangToken(token: string) {
  return /^(?:ain't|ya|tryna|gon|gonna|wanna|nah|yeah|yo|shawty|bout|ima|finna|cause)$/i.test(token)
}

function buildNgrams(text: string, size: number) {
  const tokens = text.toLowerCase().match(/[a-z0-9']+/g) ?? []
  const grams = new Set<string>()
  for (let index = 0; index <= tokens.length - size; index += 1) {
    grams.add(tokens.slice(index, index + size).join(' '))
  }
  return grams
}

function computeTermOverlap(transcriptTerms: string[], lyrics: string) {
  if (transcriptTerms.length === 0) {
    return 1
  }
  const lyricTokens = new Set(lyrics.toLowerCase().match(/[a-z0-9']+/g) ?? [])
  const matched = transcriptTerms.filter((token) => lyricTokens.has(token)).length
  return matched / transcriptTerms.length
}

function inferTone(transcript: string) {
  if (/love|heart|girl|miss|shadow|tears/i.test(transcript)) return 'romantic pain'
  if (/money|chain|whip|fit|sauce|flex/i.test(transcript)) return 'confident flex'
  if (/pressure|pain|hurt|night|broke|scar/i.test(transcript)) return 'wounded pressure'
  if (/grind|dream|build|work|legacy/i.test(transcript)) return 'hungry ambition'
  return 'raw street confession'
}

function safeArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function avg(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1)
}

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function stringArraySchema() {
  return {
    type: 'array',
    items: { type: 'string' },
  }
}

function parseJsonResponse(content: string) {
  const trimmed = content.trim()
  const withoutFence = trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    : trimmed

  return JSON.parse(withoutFence)
}
