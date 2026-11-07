const { build } = require('../package.json');

module.exports = {
  ...build,
  forceCodeSigning: true,
  artifactName: 'Superfluid-${version}-${arch}.${ext}',
  generateUpdatesFilesForAllChannels: false,
  mac: {
    ...build.mac,
    identity: '-',
    target: ['dmg', 'zip'],
    hardenedRuntime: true,
    notarize: false,
    timestamp: 'none',
    // The custom signer selects the pinned certificate without adding it to system trust.
    sign: require('./sign-mac.cjs'),
  },
  publish: {
    provider: 'github',
    owner: 'NikBelyaev',
    repo: 'superfluid',
    channel: process.env.SF_RELEASE_CHANNEL === 'nightly' ? 'nightly' : 'latest',
  },
};
