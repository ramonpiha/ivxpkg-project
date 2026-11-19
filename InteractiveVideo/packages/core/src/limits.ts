const MiB = 1024 * 1024;

/**
 * Resource limits for IVF 0.1.
 *
 * These are player POLICY, not format constants (spec 9.6) and are provisional.
 * Values marked "spec" come from section 9.6. Values marked "proposed" are NOT
 * in the spec: they are defaults chosen here so the code has something concrete
 * to enforce. Review them and record the decision in spec section 14.
 */
export const LIMITS = {
  // --- spec 9.6 ---
  /** Package compressed size (spec: 500 MB, interpreted here as MiB). */
  maxPackageBytes: 500 * MiB,
  maxArchiveEntries: 500,
  maxManifestBytes: 2 * MiB,
  maxScenes: 100,
  maxInteractionsPerScene: 100,
  maxTotalInteractions: 1000,
  maxJsonNestingDepth: 10,
  /** Individual text field, in characters (code points). */
  maxTextLength: 4096,
  maxAssetBytes: 500 * MiB,

  // --- proposed (not in the spec) ---
  /** Spec 9.6 asks for an overall uncompressed limit but gives no number. */
  maxUncompressedPackageBytes: 2048 * MiB,
  /** Spec 9.2 asks for a compression-ratio limit but gives no number. */
  maxCompressionRatio: 100,
  maxPathLength: 1024,
  maxIdLength: 64,
  minOptionsPerChoice: 2,
  maxOptionsPerChoice: 10,
  /** Upper bound for at_seconds (24 hours). */
  maxAtSeconds: 86_400,
  /** Cap on how many issues one validation run reports. */
  maxReportedIssues: 50,
} as const;
