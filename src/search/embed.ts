import {
  pipeline,
  type FeatureExtractionPipeline,
} from "@huggingface/transformers";

/** Sentence-embedding model (384-dim, ~22 MB ONNX, CPU/WASM). */
const MODEL = "Xenova/all-MiniLM-L6-v2";

let embedderPromise: Promise<FeatureExtractionPipeline> | null = null;

/**
 * Lazily load (and cache) the embedding pipeline.
 *
 * @returns A promise resolving to the loaded feature-extraction pipeline.
 */
function loadEmbedder(): Promise<FeatureExtractionPipeline> {
  embedderPromise ??= pipeline("feature-extraction", MODEL);
  return embedderPromise;
}

/**
 * Embed one or more texts into normalized 384-dim vectors.
 *
 * @param texts - The texts to embed.
 * @returns One normalized vector per input text.
 */
export async function embed(texts: string[]): Promise<number[][]> {
  const extract = await loadEmbedder();
  const output = await extract(texts, { pooling: "mean", normalize: true });
  return output.tolist() as number[][];
}
