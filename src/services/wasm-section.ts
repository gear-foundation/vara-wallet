/**
 * Extract the `sails:idl` custom section from a Gear program's WASM blob.
 *
 * Sails-JS owns the newer IDL envelope format, so this module routes through
 * its public extractor first. The small raw-section fallback keeps plain-text
 * embedded IDLs readable, including Sails IDL v1 and older beta.1-style v2
 * sections that stored UTF-8 text directly in the same custom section.
 */
import { extractIdlFromWasm } from 'sails-js/parser';

const SECTION_NAME = 'sails:idl';

/**
 * Returns the UTF-8 decoded IDL text from the `sails:idl` custom section,
 * or `null` if the section is absent.
 *
 * Throws when:
 * - the bytes are not a valid WASM module/envelope.
 * - the `sails:idl` payload is not valid UTF-8.
 */
export async function extractSailsIdl(wasm: Uint8Array): Promise<string | null> {
  const enveloped = await extractIdlFromWasm(wasm);
  if (enveloped !== null) return enveloped;
  return extractRawSailsIdl(wasm);
}

async function extractRawSailsIdl(wasm: Uint8Array): Promise<string | null> {
  const bytes = new Uint8Array(wasm);
  const mod = await WebAssembly.compile(bytes);
  const sections = WebAssembly.Module.customSections(mod, SECTION_NAME);
  if (sections.length === 0) return null;
  return new TextDecoder('utf-8', { fatal: true }).decode(sections[0]);
}
