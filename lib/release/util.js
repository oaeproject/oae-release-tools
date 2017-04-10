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

var semver = require('semver');
var shell = require('shelljs');
var util = require('util');

var CoreUtil = require('../util');

/**
 * Verify that the release process can begin with the current state of the repository.
 *
 * @param  {Number}     [errCode]   The process error code to return on failure. Default: 1
 */
var validateRelease = module.exports.validateRelease = function(remoteName, errCode) {
    errCode = errCode || 1;

    CoreUtil.logInfo('Validating repository for release');

    // This refreshes the index state, somehow, for the following validations
    CoreUtil.exec('git status', 'Error refreshing git cache with a git status', errCode);

    // Ensure there are no unstaged changes in the repository
    CoreUtil.exec('git diff-files --quiet', 'It appears you may have unstaged changes in your repository', errCode);
    CoreUtil.exec('git diff-index --quiet --cached HEAD', 'It appears you may have uncommitted changes in your repository', errCode);

    var branchName = _getCurrentBranchName(errCode);
    if (!branchName) {
        CoreUtil.logFail('You must be on a branch so the release can be pushed to the remote git repository');
        return process.exit(errCode);
    }

    // Fetch from remote so we can determine sync status
    CoreUtil.exec(util.format('git fetch %s', remoteName), util.format('Failed to fetch the remote repository "%s"', remoteName), errCode);

    // Ensure that our working copy of the branch is same as the remote
    CoreUtil.exec(util.format('git diff --quiet %s/%s', remoteName, branchName), util.format('It appears the local copy of branch "%s" is not synchronized with remote "%s". You may need to push or pull in order to ensure we can safely push release information', branchName, remoteName), errCode);

    CoreUtil.logSuccess('Repository state is clean for a release');
};

/**
 * Verify that the specified target version is a valid semver version and is greater than the current version.
 *
 * @param  {Object}     packageJson     The parsed package.json
 * @param  {String}     toVersion       The target version to validate
 * @param  {Number}     errCode         The process error code to return on failure
 */
var validateTargetVersion = module.exports.validateTargetVersion = function(packageJson, toVersion, remoteName, errCode) {
    CoreUtil.logInfo('Validating code to release target version');

    // Ensure the target version is a valid semver version
    if (!semver.valid(toVersion)) {
        CoreUtil.logFail('The target version of '.text + toVersion.error + ' is not a valid semver version'.text);
        return process.exit(errCode);
    }

    // Ensure that the new version number is greater than the old
    if (!semver.gt(toVersion, packageJson.version)) {
        CoreUtil.logFail('The target version of '.text + toVersion.error + ' should be greater than the current version '.text + packageJson.version.error);
        return process.exit(errCode);
    }

    // Ensure that the remote repository does not already have a tag for this version
    if (_hasTag(remoteName, toVersion)) {
        CoreUtil.logFail('The tag '.text + toVersion.error + ' already exists in the remote repository '.text + remoteName.error);
        return process.exit(errCode);
    }

    CoreUtil.logSuccess(util.format('Validated the target release version %s', toVersion));
};


/**
 * Update the package.json file to have the new target version.
 *
 * @param  {String}     packageJsonPath     The path to the package.json to update
 * @param  {String}     fromVersion         The expected previous version in the package.json file
 * @param  {String}     toVersion           The target version to update the package.json to
 * @param  {Number}     errCode             The process error code to return on failure
 */
var bumpPackageJsonVersion = module.exports.bumpPackageJsonVersion = function(packageJsonPath, fromVersion, toVersion, errCode) {
    var replaceSource = util.format('\n  "version": "%s",\n', fromVersion);
    var replaceWith = util.format('\n  "version": "%s",\n', toVersion);

    // Perform a bogus replace so we can get the content back from sed's output
    var contentBefore = shell.sed('-i', '}"', '}"', packageJsonPath);
    var contentAfter = shell.sed('-i', replaceSource, replaceWith, packageJsonPath);

    if (contentBefore === contentAfter) {
        // We didn't replace anything
        CoreUtil.logFail('Replacing regexp '.text + replaceSource.trim().error + ' with '.text + replaceWith.trim().error + ' in package.json resulted in no changes'.text);
        return process.exit(errCode);
    }

    if (shell.cat(packageJsonPath).indexOf(replaceWith) === -1) {
        CoreUtil.logFail('Resulting package.json file did not contain the text ' + replaceWith.trim().error);
        return process.exit(errCode);
    }

    CoreUtil.logSuccess('Successfully bumped version to '.text + toVersion.white);
};

/**
 * Shrinkwrap the current set of dependencies. It's important that unit tests are run and testing has been done with
 * this set of dependencies before shrinkwrapping them into a release.
 *
 * @param  {Number}     errCode     The process error code to return on failure. Default: 1
 */
var shrinkwrap = module.exports.shrinkwrap = function(errCode) {
    errCode = errCode || 1;
    CoreUtil.logInfo('Starting to run npm shrinkwrap');
    CoreUtil.exec('npm shrinkwrap', 'Failed to shrinkwrap dependencies', errCode);
    CoreUtil.logSuccess('Successfully shrinkwrapped dependencies');
};

/**
 * Commit the changes to package.json and tag the commit as the target version. The commit will be pushed to the
 * remote repository in a branch of the same name as the local brnch, while the tag will also be pushed to the
 * remote repository.
 *
 * @param  {String}     tagVersion  The validated target version
 * @param  {Number}     [errCode]   The process error code to return on failure. Default: 1
 */
var gitCommitVersionAndTag = module.exports.gitCommitVersionAndTag = function(tagVersion, remoteName, errCode) {
    errCode = errCode || 1;
    var commitMessage = util.format('(Release %s) Bump version', tagVersion);
    var branchName = _getCurrentBranchName(errCode);

    CoreUtil.logInfo('Committing version and tagging release');

    // Stage package.json changes
    CoreUtil.exec('git add package.json', 'Error adding package.json to git index', errCode);

    // Commit, tag and push
    CoreUtil.exec(util.format('git commit -m "%s"', commitMessage), 'Error committing to git', errCode);
    CoreUtil.exec(util.format('git tag -a %s -m v%s', tagVersion, tagVersion), 'Error creating tag for release', errCode);
    CoreUtil.logInfo('Authentication required to push tag');
    CoreUtil.exec(util.format('git push %s %s', remoteName, tagVersion), util.format('Error pushing tag for release to remote "%s"', remoteName), errCode);
    CoreUtil.logInfo('Authentication required to push shrinkwarp');
    CoreUtil.exec(util.format('git push %s %s', remoteName, branchName), util.format('Error pushing shrinkwrap for release to repo slug %s/%s', remoteName, branchName), errCode);
    CoreUtil.logSuccess('Created and pushed tag '.text + tagVersion.white + ' and '.text + '1 commit'.white);
};

/**
 * Remove the shrinkwrap from the repository and commit the removal. The commit will be pushed to the remote repository
 * in a branch of the same name as the local branch.
 *
 * @param  {String}     tagVersion  The validated target version
 * @param  {Number}     [errCode]   The process error code to return on failure. Default: 1
 */
var gitRemoveShrinkwrapAndCommit = module.exports.gitRemoveShrinkwrapAndCommit = function(tagVersion, remoteName, errCode) {
    errCode = errCode || 1;
    var commitMessage = util.format('(Release %s) Remove shrinkwrap', tagVersion);
    var branchName = _getCurrentBranchName(errCode);

    CoreUtil.logInfo('Removing shrinkwrap after tag');

    // Remove npm-shrinkwrap, commit and push
    CoreUtil.exec('git rm npm-shrinkwrap.json', 'Error removing npm-shrinkwrap.json from git index', errCode);
    CoreUtil.exec(util.format('git commit -m "%s"', commitMessage), 'Error committing shrinkwrap removal to git', errCode);
    CoreUtil.exec(util.format('git push %s %s', remoteName, branchName), util.format('Error pushing shrinkwrap removal to repo slug %s/%s', remoteName, branchName), errCode);
    CoreUtil.logSuccess('Removed shrinkwrap with '.text + '1 commit'.white);
};

/*!
 * Get the branch that the current repository is on
 *
 * @param  {Number}     [errCode]   The process error code to fail with if we cannot successfully get the result. Default: 1
 * @return {String}                 The name of the branch the current working copy is on. `null` if the current working copy is not on a named branch
 */
var _getCurrentBranchName = function(errCode) {
    errCode = errCode || 1;

    CoreUtil.logInfo('Determining current branch');

    // Determine the symbolic reference that represents the HEAD alias
    var branch = CoreUtil.exec('git symbolic-ref HEAD', 'Error determining current branch', errCode).trim();
    if (!branch) {
        return null;
    }

    // Branch is returned as refs/heads/<branch name>
    return branch.split('/').pop();
};

/*!
 * Determine whether or not the remote repository contains the provided branch
 *
 * @param  {String}     remoteName  The name of the remote to check for tags
 * @param  {Number}     [errCode]   The process error code to fail with if we cannot successfully determine of the remote has the tag or not. Default: 1
 * @param  {Boolean}                `true` if the tag exists in the remote repository, `false` otherwise
 */
var _hasTag = function(remoteName, tagName, errCode) {
    errCode = errCode || 1;

    CoreUtil.logInfo('Listing remote tags');

    var output = CoreUtil.exec(util.format('git ls-remote --tags %s %s', remoteName, tagName), 'An error occurred listning remote tags', errCode).trim();
    return (output !== '');
};
