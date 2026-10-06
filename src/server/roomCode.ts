/**
 * Room codes, on their own.
 *
 * Kept free of imports because both ends need them: the server to issue and
 * look up codes, the browser to check what someone typed before sending them
 * to a room that cannot exist. Living in the rooms module would have pulled the
 * whole server into the game's bundle for the sake of one function.
 */

/**
 * Letters and digits that cannot be mistaken for each other.
 *
 * No 0 or O, no 1, I or L. A room code is read off one screen and typed into
 * another, often by someone else, and a code that fails because of a glyph is a
 * code that fails for a reason nobody can see.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 4;

/** A random code. Not guaranteed unused: the registry checks that. */
export function generateCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[Math.floor(random() * ALPHABET.length)];
  }
  return code;
}

/**
 * A code as typed, in the form it was issued, or null if it cannot be one.
 *
 * Case does not matter and stray spaces do not matter — people type codes on
 * phones. Characters outside the alphabet are refused rather than corrected:
 * guessing that an O was meant as a 0 is guessing, and there is no 0 to mean.
 */
export function normaliseCode(raw: string): string | null {
  const code = raw.replace(/\s+/g, '').toUpperCase();
  if (code.length !== CODE_LENGTH) return null;
  for (const ch of code) if (!ALPHABET.includes(ch)) return null;
  return code;
}
