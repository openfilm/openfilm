/**
 * A node:test reporter for CI (scripts/ci-test.mjs): the files whose tests failed, one per line, each once.
 * @param {AsyncIterable<{ type: string, data: { file?: string } }>} source
 */
export default async function* failedFiles(source) {
  const seen = new Set();
  for await (const event of source) {
    if (event.type !== 'test:fail') continue;
    const file = event.data.file;
    if (!file || seen.has(file)) continue;
    seen.add(file);
    yield `${file}\n`;
  }
}
