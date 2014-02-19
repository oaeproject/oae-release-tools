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
var fs = require('fs');
var amazons3 = require('awssum-amazon-s3');
var path = require('path');
var shell = require('shelljs');
var util = require('util');

var CoreUtil = require('../util');

/**
 * Verify the release state for uploading the release the Amazon S3
 *
 * @param  {String}     packagePath     The path to the release package to upload
 * @param  {String}     checksumPath    The path to the checksum file to upload
 * @param  {Number}     [errCode]       The error code to report if the validation fails. Default: 1
 */
var validateUpload = module.exports.validateUpload = function(packagePath, checksumPath, errCode) {
    errCode = errCode || 1;

    if (!shell.test('-f', packagePath)) {
        CoreUtil.logFail(util.format('The package file "%s" does not exist', packagePath));
        return process.exit(errCode || 1);
    } else if (!shell.test('-f', checksumPath)) {
        CoreUtil.logFail(util.format('The checksum file "%s" does not exist', checksumPath));
        return process.exit(errCode);
    } else if (!process.env.AWS_ACCESS_KEY_ID) {
        CoreUtil.logFail('Environment variable "AWS_ACCESS_KEY_ID" must be set');
        return process.exit(errCode);
    } else if (!process.env.AWS_SECRET_ACCESS_KEY) {
        CoreUtil.logFail('Environment variable "AWS_SECRET_ACCESS_KEY" must be set');
        return process.exit(errCode);
    }
};

/**
 * Upload the package and checksum artifacts to amazon s3
 *
 * @param  {String}     bucketName      The name of the Amazon S3 bucket to which to upload the artifacts
 * @param  {String}     regionId        The Amazon region to upload them to
 * @param  {String}     packagePath     The local file-system path where the package file is located
 * @param  {String}     checksumPath    The local file-system path where the checksum file is located
 * @param  {Function}   callback        Invoked when the process completes
 * @param  {Error}      callback.err    An error that occurred, if any
 */
var upload = module.exports.upload = function(bucketName, regionId, packagePath, checksumPath, callback) {
    var describe = CoreUtil.gitDescribe();
    if (!_.isString(describe.tag)) {
        return callback(new Error(util.format('Git describe did not return a "tag": %s', JSON.stringify(describe))));
    } else if (describe.tag.split('.').length !== 3) {
        return callback(new Error(util.format('Most recent tag must contain exactly 2 dots. e.g., <number>.<number>.<number>. However, it was: %s')), describe.tag);
    }

    // When the tag version is something like 4.2.5, we chop off the patch version for the directory to be: 4.2
    var baseName = describe.tag.split('.').slice(0, 2).join('.');
    var packageUploadPath = path.join(baseName, _filename(packagePath));
    var checksumUploadPath = path.join(baseName, _filename(checksumPath));

    // The s3 object which can be used to upload to S3
    var s3 = new amazons3.S3({
        'accessKeyId': process.env.AWS_ACCESS_KEY_ID,
        'secretAccessKey': process.env.AWS_SECRET_ACCESS_KEY,
        'region': regionId
    });

    // First upload the package file    
    _upload(s3, bucketName, packageUploadPath, packagePath, function(err) {
        if (err) {
            return callback(err);
        }

        _upload(s3, bucketName, checksumUploadPath, checksumPath, function(err) {
            if (err) {
                return callback(err);
            }

            return callback();
        });
    });
};

/**
 * Perform the upload to Amazon S3
 */
var _upload = function(s3, bucketName, objectName, srcPath, callback) {
    fs.stat(srcPath, function(err, stat) {
        if (err) {
            return callback(err);
        }

        CoreUtil.logInfo(util.format('Uploading file %s to %s', srcPath.white, util.format('s3://%s', path.join(bucketName, objectName)).white));
        return s3.PutObject({'BucketName': bucketName, 'ObjectName': objectName, 'ContentLength': stat.size, 'Body': fs.createReadStream(srcPath)}, callback);
    });
};

/**
 * Get the filename (with extension) from a full file path
 */
var _filename = function(path) {
    return path.split('/').pop();
};
