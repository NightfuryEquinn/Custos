/**
 * Shared string literals for the SIWE-style sign-in challenge message.
 *
 * Both the server (`buildAuthMessage`, which issues the challenge) and the
 * client (which must validate a challenge before ever signing it — see
 * `isValidAuthChallenge` in `@/frontend/lib/crypto/e2ee`) import these so the
 * two definitions cannot drift out of sync with each other.
 */
export const AUTH_MESSAGE_PREAMBLE = "Custos wants you to sign in with your Web3 identity.";
export const AUTH_MESSAGE_VERIFY_LINE =
  "Sign in to verify you control this key. This will not send a transaction or cost gas.";
