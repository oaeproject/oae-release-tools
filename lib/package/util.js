/*!
 * Copyright 2013 Apereo Foundation (AF) Licensed under the
 * Educational Community License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License. You may
 * obtain a copy of the License at
 *
 *     http://opensource.org/licenses/ECL-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an "AS IS"
 * BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 */

var _ = require('underscore');
var fs = require('fs');
var shell = require('shelljs');
var util = require('util');

var CoreUtil = require('../util');

/**
 * Before performing a packaging of release artifacts, this method ensures that the directories
 * are in a state in which it is safe to package.
 *
 * @param  {String}     dest        The destination directory in which the release artifacts will be stored
 * @param  {Number}     [errCode]   The process error code to return on failure. Default: 1
 */
var validatePackage = module.exports.validatePackage = function(dest, errCode) {
    errCode = errCode || 1;
    if (shell.test('-d', dest)) {
        CoreUtil.logFail('The output directory exists, please delete it first');
        return process.exit(errCode);
    }
};

/**
 * Copy the release files from the tested root application directory to the distribution source directory.
 *
 * @param  {String}     dest        The root distribution directory
 * @param  {Number}     [errCode]   The process error code to return on failure. Default: 1
 * @return {Object}                 An object with field `srcDir` indicating the directory the source files were copied into
 */
var copyHilaryReleaseFiles = module.exports.copyHilaryReleaseFiles = function(dest, errCode) {
    errCode = errCode || 1;

    // We will wind up deleting stuff out of this directory, so make sure it doesn't exist yet
    validatePackage(dest, errCode);

    var srcDir = util.format('%s/src', dest);

    CoreUtil.logInfo('Starting to copy the release artifacts');

    // Create the target source directory
    shell.mkdir('-p', srcDir);

    // Copy individual top-level files. They should all exist
    CoreUtil.exec('cp app.js ' + srcDir);
    CoreUtil.exec('cp config.js ' + srcDir);
    CoreUtil.exec('cp LICENSE ' + srcDir);
    CoreUtil.exec('cp npm-shrinkwrap.json ' + srcDir);
    CoreUtil.exec('cp package.json ' + srcDir);
    CoreUtil.exec('cp README.md ' + srcDir);

    // Using shell.exec here because shell.cp does not copy the files in the same way, which results in
    // (I think) issues with symlinks that result in phantomjs/webshot not functioning properly on the released binary
    // package. If you change this, ensure you test "link" content items have previews generated properly on the resulting
    // distribution.
    CoreUtil.exec('cp -RLf node_modules ' + srcDir);

    // Remove all orig and rej files as they are useless and can trip up the debian packaging process
    CoreUtil.exec('find ' + srcDir + ' -name "*.orig" -exec rm {} \\;');
    CoreUtil.exec('find ' + srcDir + ' -name "*.rej" -exec rm {} \\;');

    // Delete the node_modules/oae-*/tests directories
    _.each(shell.ls(srcDir + '/node_modules/oae-*'), function(modulePath) {
        shell.rm('-rf', modulePath + '/tests');
    });

    CoreUtil.logSuccess('Successfully copied hilary release artifacts to '.text + srcDir.white);
    return {'srcDir': srcDir};
};

/**
 * Save the build info to the `build-info.json` file in the target distribution directory.
 *
 * @param  {String}     srcDir          The directory to save the build info json file to
 * @param  {String}     version         The version of being released
 * @param  {Object}     systemInfo      The system information, from `CoreUtil.getSystemInfo()`
 * @param  {Number}     [errCode]       The process error code to return on failure. Default: 1
 */
var saveBuildInfo = module.exports.saveBuildInfo = function(srcDir, version, systemInfo, errCode) {
    errCode = errCode || 1;

    var targetInfoPath = util.format('%s/build-info.json', srcDir);
    var buildInfo = _.extend({}, systemInfo, {'version': version});
    fs.writeFileSync(targetInfoPath, JSON.stringify(buildInfo, null, 4) + '\n');
    CoreUtil.logSuccess('Successfully wrote system and version information to '.text + targetInfoPath.white);
};

/**
 * Package the artifacts into a tar.gz file for distribution.
 *
 * @param  {String}     srcDir      The directory containing the files that need to be packaged
 * @param  {String}     tarballDir  The directory where the resulting package will be located
 * @param  {String}     filename    The filename (without the extention) of the package to create
 * @param  {Number}     [errCode]   The process error code to return on failure. Default: 1
 * @return {Object}                 An object with field `packagePath` whose value holds the path to the release tarball
 */
var packageRelease = module.exports.packageRelease = function(srcDir, tarballDir, filename, errCode) {
    errCode = errCode || 1;
    var tarballPath = util.format('%s/%s.tar.gz', tarballDir, filename);

    CoreUtil.logInfo('Starting to package the release artifacts (tar.gz)');
    CoreUtil.exec(util.format('tar -czvf %s -C %s .', tarballPath, srcDir), 'Error creating the distribution tar.gz file', errCode);
    CoreUtil.logSuccess('Successfully created release tarball at '.text + tarballPath.white);
    return {'packagePath': tarballPath};
};

/**
 * Generate a sha1 checksum of a package for integrity verification. It will create a file with name
 * <packagePath>.sha1.txt located in the same directory as the specified package.
 *
 * @param  {String}     packagePath     The path to the package for which to generate a sha1 checksum
 * @param  {Number}     [errCode]       The process error code to return on failure. Default: 1
 * @return {Object}                     An object with field `checksumPath` whose value holds the path to the package checksum
 */
var checksumPackage = module.exports.checksumPackage = function(packagePath, errCode) {
    errCode = errCode || 1;
    var sha1sumPath = packagePath + '.sha1.txt';

    var sha1sum = CoreUtil.exec(util.format('shasum %s', packagePath), 'Error creating checksum for the release package', errCode).split(' ')[0];
    fs.writeFileSync(sha1sumPath, sha1sum);
    CoreUtil.logSuccess('Created sha1 signature '.text + sha1sum.white + ' located at '.text + sha1sumPath.white);
    return {'checksumPath': sha1sumPath};
};

