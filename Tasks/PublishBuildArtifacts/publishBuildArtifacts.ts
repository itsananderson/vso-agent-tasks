/// <reference path="../../definitions/node.d.ts"/>
/// <reference path="../../definitions/Q.d.ts" />
/// <reference path="../../definitions/vso-task-lib.d.ts" />

import path = require('path');
import fs = require('fs');
import Q = require('q');
var tl = require("vso-task-lib");

function getCommonLocalPath(files: string[]): string {
    if (!files || files.length === 0) {
        return "";
    }
    else {
        var root: string = files[0];

        for (var index = 1; index < files.length; index++) {
            root = _getCommonLocalPath(root, files[index]);
            if (!root) {
                break;
            }
        }

        return root;
    }
}

function _getCommonLocalPath(path1: string, path2: string): string {
    var path1Depth = getFolderDepth(path1);
    var path2Depth = getFolderDepth(path2);

    var shortPath: string;
    var longPath: string;
    if (path1Depth >= path2Depth) {
        shortPath = path2;
        longPath = path1;
    }
    else {
        shortPath = path1;
        longPath = path2;
    }

    while (!isSubItem(longPath, shortPath)) {
        var parentPath = path.dirname(shortPath);
        if (path.normalize(parentPath) === path.normalize(shortPath)) {
            break;
        }
        shortPath = parentPath;
    }

    return shortPath;
}

function isSubItem(item: string, parent: string): boolean {
    item = path.normalize(item);
    parent = path.normalize(parent);
    return item.substring(0, parent.length) == parent
        && (item.length == parent.length || (parent.length > 0 && parent[parent.length - 1] === path.sep) || (item[parent.length] === path.sep));
}

function getFolderDepth(fullPath: string): number {
    if (!fullPath) {
        return 0;
    }

    var current = path.normalize(fullPath);
    var parentPath = path.dirname(current);
    var count = 0;
    while (parentPath !== current) {
        ++count;
        current = parentPath;
        parentPath = path.dirname(current);
    }

    return count;
}

// contents is a multiline input containing glob patterns
var contents: string[] = tl.getDelimitedInput('Contents', '\n');
var artifactName: string = tl.getInput('ArtifactName');
var artifactType: string = tl.getInput('ArtifactType');
// targetPath is used for file shares
var targetPath: string = tl.getInput('TargetPath');
var findRoot: string = tl.getPathInput('CopyRoot');

if (!artifactName) {
    // nothing to do
    tl.warning('Artifact name is not specified.');
}
else if (!artifactType) {
    // nothing to do
    tl.warning('Artifact type is not specified.');
}
else {
    artifactType = artifactType.toLowerCase();
    // back compat. remove after 82
    if (artifactType === "localpath") {
        artifactType = "filepath";
    }
    
    var stagingFolder: string = tl.getVariable('build.stagingdirectory');
    stagingFolder = path.join(stagingFolder, artifactName);
    
    console.log('Cleaning staging folder: ' + stagingFolder);
    tl.rmRF(stagingFolder); 

    tl.debug('Preparing artifact content in staging folder ' + stagingFolder + '...');

    // enumerate all files
    
    var files: string[] = [];
    var allFiles: string[] = tl.find(findRoot);
    if (contents && allFiles) {
        tl.debug("allFiles contains " + allFiles.length + " files");

        // a map to eliminate duplicates
        var map = {};
        for (var i: number = 0; i < contents.length; i++) {
            var pattern = contents[i].trim();
            tl.debug('Matching ' + pattern);

            var realPattern = path.join(findRoot, pattern);
            tl.debug('Actual pattern: ' + realPattern);

            var matches = tl.match(allFiles, realPattern, { matchBase: true });
            tl.debug('Matched ' + matches.length + ' files');
            for (var j: number = 0; j < matches.length; j++) {
                var matchPath = matches[j];
                if (!map.hasOwnProperty(matchPath)) {
                    map[matchPath] = true;
                    files.push(matchPath);
                }
            }
        }
    }
    else {
        tl.debug("Either contents or allFiles is empty");
        files = allFiles;
    }

    // copy the files to the staging folder

    console.log("found " + files.length + " files");
    if (files.length > 0) {
        // make sure the staging folder exists
        tl.mkdirP(stagingFolder);

        var commonRoot = getCommonLocalPath(files);
        var useCommonRoot = !!commonRoot;
        if (useCommonRoot) {
            tl.debug("There is a common root (" + commonRoot + ") for the files. Using the remaining path elements in staging folder.");
        }

        try {
            var createdFolders = {};
            files.forEach((file: string) => {
                var stagingPath = stagingFolder;
                if (useCommonRoot) {
                    var relativePath = file.substring(commonRoot.length)
                        .replace(/^\\/g, "")
                        .replace(/^\//g, "");
                    stagingPath = path.dirname(path.join(stagingFolder, relativePath));
                }
                
                if (!createdFolders[stagingPath]) {
                    tl.debug("Creating folder " + stagingPath);
                    tl.mkdirP(stagingPath);
                    createdFolders[stagingPath] = true;
                }
                
                tl.debug("Copying " + file + " to " + stagingPath);
                tl.cp("-Rf", file, stagingPath);
            });

            var data = {
                artifacttype: artifactType,
                artifactname: artifactName
            };
    
            // upload or copy
            if (artifactType === "container") {
                data["containerfolder"] = artifactName;
                data["localpath"] = stagingFolder;
                tl.command("artifact.upload", data, "Uploading artifact");
            }
            else if (artifactType === "filepath") {
                tl.mkdirP(targetPath);
                tl.cp("-Rf", stagingFolder, targetPath);

                data["artifactlocation"] = targetPath;
                tl.command("artifact.associate", data, "Associating artifact");
            }
        }
        catch (err) {
            tl.error(err);
            tl.exit(1);
        }
    }
}
