const { build } = require('../package.json');
delete build.mac.identity;

module.exports = {
  ...build,
  forceCodeSigning: true,
  artifactName: 'Superfluid-${version}-${arch}.${ext}',
  generateUpdatesFilesForAllChannels: false,
  mac: { ...build.mac, target: ['dmg', 'zip'], hardenedRuntime: true, notarize: true },
  publish: {
    provider: 'github',
    owner: 'NikBelyaev',
    repo: 'superfluid',
    channel: process.env.SF_RELEASE_CHANNEL === 'nightly' ? 'nightly' : 'latest',
  },
};
