import { randomBytes } from "node:crypto";

/**
 * Server-minted ids. Deliberately not model.js's `nid()`: that one is six
 * base36 characters, which is fine for an object inside one document where a
 * collision is scoped to the drawing someone is looking at, and far too narrow
 * for a primary key shared by every firm on the server.
 *
 * Drawing ids still arrive from the client - a document has an identity before
 * it has ever been written anywhere, which is the point of §2 - so this is used
 * for the rows the server itself creates.
 */
export function sid(prefix) {
  return `${prefix}_${randomBytes(12).toString("base64url")}`;
}
