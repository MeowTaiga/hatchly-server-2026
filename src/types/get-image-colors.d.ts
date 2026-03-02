declare module 'get-image-colors' {
  type ChromaColor = { hex: () => string };
  function getImageColors(input: Buffer, type?: string, options?: { count?: number }): Promise<ChromaColor[]>;
  export default getImageColors;
}
