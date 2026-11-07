const { signAsync } = require('@electron/osx-sign');
const { X509Certificate } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

module.exports = async (options) => {
  if (!options.keychain)
    throw new Error('Import the release certificate into a dedicated signing keychain.');
  const certificate = new X509Certificate(
    readFileSync(join(__dirname, '../build/signing-cert.pem')),
  );
  const identity = certificate.fingerprint.replaceAll(':', '');
  await signAsync({
    ...options,
    identity,
    identityValidation: false,
    gatekeeperAssess: false,
  });
  // Pin the certificate explicitly: a self-signed identity is not an Apple trust anchor.
  execFileSync(
    '/usr/bin/codesign',
    ['--verify', '--deep', '--strict', '-R', `=certificate leaf = H"${identity}"`, options.app],
    { stdio: 'pipe' },
  );
};
