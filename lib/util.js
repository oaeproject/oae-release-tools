/*!
 * Copyright 2014 Apereo Foundation (AF) Licensed under the
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
var colors = require('colors');
var semver = require('semver');
var shell = require('shelljs');
var util = require('util');

colors.setTheme({
    'error': 'red',
    'warn': 'yellow',
    'success': 'green',
    'info': 'grey',
    'text': 'grey'
});

/**
 * Log the message with failure priority
 *
 * @param  {String}     msg     The message to log
 */
var logFail = module.exports.logFail = function(msg) {
    console.error('['.white + 'error'.error + '] '.white + msg.text);
};

/**
 * Log the message with warning priority
 *
 * @param  {String}     msg     The message to log
 */
var logWarn = module.exports.logWarn = function(msg) {
    console.warn('['.white + 'warn'.warn + '] '.white + msg.text);
};

/**
 * Log the message with success priority
 *
 * @param  {String}     msg     The message to log
 */
var logSuccess = module.exports.logSuccess = function(msg) {
    console.log('['.white + 'success'.success + '] '.white + msg.text);
};

/**
 * Log the message with info priority
 *
 * @param  {String}     msg     The message to log
 */
var logInfo = module.exports.logInfo = function(msg) {
    console.log('['.white + 'info'.info + '] '.white + msg.text);
};

/**
 * Convenience method to execute a command, then log and bail if there is an error.
 *
 * @param  {String}     cmd         The command to execute
 * @param  {String}     [errMsg]    The error message to display on failure. Default: something technical but low-level
 * @param  {Number}     [errCode]   The error code to return if it fails. Default: the error code of the internal process return code
 * @param  {Boolean}    [loud]      Whether or not to show the output of the command on the console. Not if the command fails, the output is always displayed in the console. Default: `false`
 */
var exec = module.exports.exec = function(cmd, errMsg, errCode, loud) {
    errMsg = errMsg || 'There was an error executing command `' + cmd + '`';
    var exec = shell.exec(cmd, {'silent': !loud});
    if (exec.code !== 0) {
        // If we didn't output to the console through the command, dump the output on stderr
        if (!loud) {
            console.error(exec.output);
        }

        logFail(errMsg.text + util.format(' (`%s` === %s)', cmd, exec.code).error);
        return process.exit(errCode || exec.code);
    }

    return exec.output;
};

/**
 * Get the system information of this build machine.
 */
var getSystemInfo = module.exports.getSystemInfo = function() {
    var systemInfo = {
        'nodeVersion': exec('node -v').trim().slice(1),
        'uname': exec('uname -a').trim()
    };

    logInfo('Node Version: '.text + systemInfo.nodeVersion.white);
    logInfo('Platform: '.text + systemInfo.uname.white);

    return systemInfo;
};

/**
 * Load the package.json file and ensure it is actually for the expected module and a valid version we can
 * work with.
 *
 * @param  {String}     packageJsonPath     The path to expect the package.json file
 * @param  {String}     expectedName        The expected name of the module. Probably either "Hilary" or "3akai-ux"
 * @param  {Number}     [errCode]           The process error code to return on failure. Default: 1
 * @return {Object}                         The parsed package.json file that has been validated
 */
var loadPackageJson = module.exports.loadPackageJson = function(packageJsonPath, expectedName, errCode) {
    errCode = errCode || 1;
    var packageJson = null;

    // Try and parse it from the file-system
    try {
        packageJson = require(packageJsonPath);
    } catch (ex) {
        // Ensure it was valid JSON if it existed
        if (ex.code !== 'MODULE_NOT_FOUND') {
            logFail('Parsing error trying to load '.text + packageJsonPath.error + '. It should be a valid JSON file'.text);
            throw ex;
        }
    }

    // Ensure it was found
    if (!packageJson) {
        logFail('Could not locate the package.json file at '.text + packageJsonPath.error);
        return process.exit(errCode);
    }

    // Ensure it is the Hilary package.json
    if (packageJson.name !== expectedName) {
        logFail(util.format('The package.json file located at '.text + packageJsonPath.error + ' is not the package.json for the expected module (its "name" attribute is not "%s")', expectedName).text);
        return process.exit(errCode);
    }

    // Ensure we have a version we can work with
    if (!semver.valid(packageJson.version)) {
        logFail('The package.json file located at '.text + packageJsonPath.error + ' does not have a valid version associated to it (its "version" attribute is not set or is not a valid semver version)'.text);
        return process.exit(errCode);
    }

    logSuccess(util.format('Successfully parsed and validated ' + packageJsonPath + ' (name: %s, version: %s)', packageJson.name, packageJson.version));

    return packageJson;
};

/**
 * Run the unit tests with `grunt test`.
 *
 * @param  {Number}     [errCode]           The process error code to return on failure. Default: 1
 */
var runUnitTests = module.exports.runUnitTests = function(errCode) {
    errCode = errCode || 1;
    logInfo('Starting to run unit tests');
    exec('node_modules/.bin/grunt test', 'The unit tests did not succeed, aborting release', errCode, true);
    logSuccess('Unit tests completed successfully');
};

/**
 * Get the prettiest-looking version we can from git. This essentially uses `gitDescribe` and
 * then tries to strip as much from the version string as possible to make it usable as a version
 * number.
 *
 * @param  {String}     [fromTag]   The root tag from which to try and pivot our version. Default: will use the most recent tag found on the branch
 * @param  {Number}     [errCode]   The process error code to return on failure. Default: 1
 * @return {String}                 The string version
 */
var gitVersion = module.exports.gitVersion = function(fromTag, errCode) {
    errCode = errCode || 1;
    var describe = gitDescribe(fromTag, errCode);

    var version = describe.tag;
    if (describe.commits) {
        version += util.format('-%s', describe.commits);
    }

    if (describe.hash) {
        version += util.format('-%s', describe.hash);
    }

    return version;
};

/**
 * Run git describe to get the current estimated version of the codebase.
 *
 * @param  {String}     [fromTag]   The root tag from which to try and pivot our version. Default: will use the most recent tag found on the branch
 * @param  {Number}     [errCode]   The process error code to return on failure. Default: 1
 * @return {Object}                 An object with fields:
 *
 *  * 'tag': The tag name of the most recent tag, as suggested by `fromTag`
 *  * 'commits': How many commits our current version is ahead of that tag
 *  * 'hash': If we are not on the `fromTag`, this will be the hash of the current commit
 */
var gitDescribe = module.exports.gitDescribe = function(fromTag, errCode) {
    errCode = errCode || 1;

    var cmd = 'git describe --always --tag';
    if (fromTag) {
        cmd += ' --match=' + fromTag;
    }

    // Describe returns something like this: <tag name>-<number of commits since tag>-g<commit hash>
    var describe = exec(cmd).trim().split('-');
    describe = {
        'tag': describe.shift(),
        'commits': parseInt(describe.shift(), 10),
        'hash': describe.shift()
    };

    if (fromTag && fromTag !== describe.tag) {
        logFail('The source tag of '.text + fromTag.error + ' was not found with git describe'.text);
        return process.exit(errCode);
    }

    // Git prefixes the hash with a 'g' to indicate it's from git. We'll slice that off because we are aware of this.
    if (describe.hash) {
        describe.hash = describe.hash.slice(1);
    }

    return describe;
};
