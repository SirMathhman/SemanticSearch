/**
 * A provider that turns texts into normalized embedding vectors.
 */
export interface Embedder {
  /**
   * Embed one or more texts.
   *
   * @param texts - The texts to embed.
   * @returns One normalized vector per input text.
   */
  embed(texts: string[]): Promise<number[][]>;
}
