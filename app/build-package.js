const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { packager } = require('@electron/packager');

const allPlatforms = ["linux"];

const args = process.argv.slice(2);

let shouldZip = false;

let platforms = args.filter(arg => {
    if (arg === "-zip") {
        shouldZip = true;
        return false;
    }
    if( !allPlatforms.includes(arg) ) {
        if( arg.startsWith("-") ) {
            console.error("Unrecognised command line argument: "+arg);
        } else {
            console.error(`Unrecognised platform: ${arg}. The available platforms are: ${allPlatforms}`);
        }
        process.exit(1);
    }
    return true;
});

platforms = platforms.length ? platforms : ["linux"];


function runCommand(command) {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error: ${error.message}`);
                reject(error);
                return;
            }
            if (stderr) {
                console.error(`Stderr: ${stderr}`);
                reject(stderr);
                return;
            }
            console.log(`Stdout: ${stdout}`);
            resolve(stdout);
        });
    });
}

// Clean
function deleteAtPath(relativePath) {
    let absPath = path.normalize(relativePath);
    if( fs.existsSync(absPath) ) {
        console.log("Cleaning "+absPath)
        fs.rmSync(absPath, { recursive: true, force: true });
    }
}

async function createZip(sourceDir, targetZipPath) {
    sourceDir = path.resolve(sourceDir);
    targetZipPath = path.resolve(targetZipPath);
    await runCommand(`cd ${sourceDir} && zip -r ${targetZipPath} . -x "*.DS_Store"`);
}


async function buildPackageForPlatform(targetPlatform) {

    if( targetPlatform != "linux" ) {
        throw "Unexpected platform: "+targetPlatform;
    }

    let outputAppDirPath = "../Inky-linux-x64";
    let finalZipOrDmgPath = "../ReleaseUpload/Inky_linux.zip";

    // Clean
    deleteAtPath(outputAppDirPath);
    deleteAtPath(finalZipOrDmgPath);

    let opts = {
        dir: '.', // Source directory (app directory)
        out: "..",
        name: 'Inky', 
        overwrite: true,
        appBundleId: 'com.inkle.inky',
        prune: true,
        asar: {
            unpackDir: 'main-process/ink'
        },
        platform: "linux",
        arch: "x64",
        ignore: ['build-package.js']
    };

    const appPaths = await packager(opts);
    

    // Only zip it up if requested, otherwise assume
    // we're doing a local build just to run locally
    if( shouldZip ) {

        // Create ReleaseUpload folder if necesscary
        let releaseFolderPath = path.normalize("../ReleaseUpload");
        if( !fs.existsSync(releaseFolderPath) ) {
            fs.mkdirSync(releaseFolderPath);
        }

        await createZip(outputAppDirPath, finalZipOrDmgPath)
    }
    
    console.log('Build completed successfully.');
}


(async function tryBuildPackages() {
    try {
        for(let i=0; i<platforms.length; i++) {
            await buildPackageForPlatform(platforms[i]);
        }
    } catch (error) {
        console.error('Package build failed: ', error);
    }
})()